import {
    elizaLogger,
    type ActionExample,
    type Content,
    type HandlerCallback,
    type IAgentRuntime,
    type Memory,
    ModelClass,
    type State,
    composeContext,
    generateObject,
    type Action,
} from "@elizaos/core";
import { WalletProvider } from "../providers/wallet";
import { GraphqlProvider } from "../providers/graphql";
import { validateMultiversxConfig } from "../enviroment";
import { pairSchema } from "../utils/schemas";
import { MVX_NETWORK_CONFIG } from "../constants";
import { createPairQuery } from "../graphql/createPairQuery";
import { NativeAuthProvider } from "../providers/nativeAuth";
import { isUserAuthorized } from "../utils/accessTokenManagement";
import { Transaction, TransactionPayload } from "@multiversx/sdk-core";

export interface ICreatePairContent extends Content {
    firstTokenID: string;
    secondTokenID: string;
}

const pairTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.

Example response:
\`\`\`json
{
    "firstTokenID": "EGLD",
    "secondTokenID": "USDC"
}
\`\`\`

{{recentMessages}}

Given the recent messages, extract the following information about the requested pair creation:
- Token A
- Token B

Respond with a JSON markdown block containing only the extracted values.`;

export default {
    name: "CREATE_PAIR",
    similes: ["CREATE_POOL", "CREATE_TOKEN_PAIR"],
    validate: async (runtime: IAgentRuntime, message: Memory) => {
        elizaLogger.log("Validating config for user:", message.userId);
        await validateMultiversxConfig(runtime);
        return true;
    },
    description: "Create a pair of tokens",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback?: HandlerCallback
    ) => {
        elizaLogger.log("Starting CREATE_PAIR handler...");

        // Check user authorization
        if (!isUserAuthorized(message.userId, runtime)) {
            elizaLogger.error(
                "Unauthorized user attempted to create a pair:",
                message.userId
            );
            if (callback) {
                callback({
                    text: "You do not have permission to create a pair.",
                    content: { error: "Unauthorized user" },
                });
            }
            return false;
        }

        // Compose or update state
        if (!state) {
            state = (await runtime.composeState(message)) as State;
        } else {
            state = await runtime.updateRecentMessageState(state);
        }

        // Generate pair context
        const pairContext = composeContext({
            state,
            template: pairTemplate,
        });

        const content = await generateObject({
            runtime,
            context: pairContext,
            modelClass: ModelClass.SMALL,
            schema: pairSchema,
        });

        const pairContent = content.object as ICreatePairContent;

        // Validate pair content
        if (
            !pairContent.firstTokenID ||
            !pairContent.secondTokenID ||
            typeof pairContent.firstTokenID !== "string" ||
            typeof pairContent.secondTokenID !== "string"
        ) {
            elizaLogger.error("Invalid content for CREATE_PAIR action.");

            callback?.({
                text: "Unable to process pair creation request. Invalid content provided.",
                content: { error: "Invalid pair content" },
            });

            return false;
        }

        try {
            // Retrieve settings and initialize providers
            const privateKey = runtime.getSetting("MVX_PRIVATE_KEY");
            const network = runtime.getSetting("MVX_NETWORK");
            const networkConfig = MVX_NETWORK_CONFIG[network];

            const walletProvider = new WalletProvider(privateKey, network);
            const config = {
                origin: "https://devnet.xexchange.com",
                apiUrl: networkConfig.apiURL,
            };

            const nativeAuthProvider = new NativeAuthProvider(config);
            await nativeAuthProvider.initializeClient();

            const address = walletProvider.getAddress().toBech32();
            const accessToken =
                await nativeAuthProvider.getAccessToken(walletProvider);

            const graphqlProvider = new GraphqlProvider(
                networkConfig.graphURL,
                { Authorization: `Bearer ${accessToken}` }
            );

            // Fetch token data
            const tokenAData = await walletProvider.getTokenData(
                pairContent.firstTokenID
            );
            const tokenBData = await walletProvider.getTokenData(
                pairContent.secondTokenID
            );

            if (!tokenAData?.identifier || !tokenBData?.identifier) {
                throw new Error("Invalid token IDs provided.");
            }

            // Prepare variables and execute the GraphQL query
            const variables = {
                firstTokenID: tokenAData.identifier,
                secondTokenID: tokenBData.identifier,
            };

            const { createPair } = await graphqlProvider.query<any>(
                createPairQuery,
                variables
            );

            if (!createPair) {
                throw new Error(
                    "Pair creation failed. No response from GraphQL."
                );
            }

            // Verify full GraphQL answer
            console.log("createPair GraphQL response:", createPair);

            // Prepare and send the transaction
            const txToBroadcast = {
                sender: address,
                data: TransactionPayload.fromEncoded(createPair.data),
                nonce: await walletProvider
                    .getAccount(walletProvider.getAddress())
                    .then((account) => account.nonce),
                gasLimit: createPair.gasLimit,
                receiver: createPair.receiver,
                chainID: createPair.chainID
            };

            const tx = new Transaction(txToBroadcast);
            const signature = await walletProvider.signTransaction(tx);
            tx.applySignature(signature);

            const txHash = await walletProvider.sendTransaction(tx);
            const txURL = walletProvider.getTransactionURL(txHash); // Transaction URL

            callback?.({
                text: `Transaction sent successfully! You can view it here: ${txURL}.`,
            });

            return true;
        } catch (error) {
            elizaLogger.error("Error during pair creation:", error.message);
            console.log("Full error:", error);

            callback?.({
                text: "An error occurred while creating the token pair.",
                content: { error: error.message },
            });

            return false;
        }
    },

    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Create a pair with EGLD and USDC",
                },
            },
            {
                user: "{{agent}}",
                content: {
                    text: "Creating a pair with EGLD and USDC...",
                },
            },
        ],
    ] as ActionExample[][],
} as Action;
