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
import {
    Transaction,
    TransactionPayload,
} from "@multiversx/sdk-core/out";
import { isUserAuthorized } from "../utils/accessTokenManagement";

type PairResultType = {
    createPair: {
        noAuthTransactions: {
            value: string;
            receiver: string;
            gasPrice: bigint;
            gasLimit: bigint;
            data: TransactionPayload;
            chainID: string;
            version: number;
            sender: string;
            nonce: number;
        }[];
    };
};

export interface ICreatePairContent extends Content {
    firstTokenID: string;
    secondTokenID: string;
}

const pairTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.

Example response:
\`\`\`json
{
    "firstTokenID": "EGLD",
    "secondTokenID": "USDC",
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

        if (!state) {
            state = (await runtime.composeState(message)) as State;
        } else {
            state = await runtime.updateRecentMessageState(state);
        }

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

        const isPairContent =
            typeof pairContent.firstTokenID === "string" &&
            typeof pairContent.secondTokenID === "string";

        elizaLogger.log("pairContent:", pairContent);

        if (!isPairContent) {
            elizaLogger.error("Invalid content for CREATE_PAIR action.");

            callback?.({
                text: "Unable to process pair creation request. Invalid content provided.",
                content: { error: "Invalid pair content" },
            });

            return false;
        }

        try {
            // Retrieve the private key and network configuration settings
            const privateKey = runtime.getSetting("MVX_PRIVATE_KEY");
            const network = runtime.getSetting("MVX_NETWORK");
            const networkConfig = MVX_NETWORK_CONFIG[network];

            // Initialize the wallet provider with the private key and network configuration
            const walletProvider = new WalletProvider(privateKey, network);

            const config = {
                origin: "https://devnet.xexchange.com",
                apiUrl: networkConfig.apiURL,
            };

            // Initialize the NativeAuthProvider with the config
            const nativeAuthProvider = new NativeAuthProvider(config);

            // Initialize the client for native authentication
            await nativeAuthProvider.initializeClient();

            // Retrieve the address from the wallet provider
            const address = walletProvider.getAddress().toBech32();

            // Get the access token for authentication
            const accessToken =
                await nativeAuthProvider.getAccessToken(walletProvider);

            // Get the accessToken for debugging
            // console.log("Authorization Token:", accessToken);

            // Initialize the GraphQL provider with the access token for authorization
            const graphqlProvider = new GraphqlProvider(
                networkConfig.graphURL,
                { Authorization: `Bearer ${accessToken}` }
            );

            // Fetch token data for firstTokenID and secondTokenID from the wallet
            let tokenAData = null;
            tokenAData = await walletProvider.getTokenData(
                pairContent.firstTokenID
            );
            let tokenBData = null;
            tokenBData = await walletProvider.getTokenData(
                pairContent.secondTokenID
            );

            // Validate the token information to ensure the identifiers are valid
            if (!tokenAData || !tokenAData.identifier) {
                throw new Error(
                    `Invalid firstTokenID identifier for ${pairContent.firstTokenID}`
                );
            }
            if (!tokenBData || !tokenBData.identifier) {
                throw new Error(
                    `Invalid secondTokenID identifier for ${pairContent.secondTokenID}`
                );
            }

            // Prepare the variables for the GraphQL query to create the pair
            const variables = {
                firstTokenID: tokenAData.identifier,
                secondTokenID: tokenBData.identifier,
            };

            // Execute the GraphQL query to create the pair
            const { createPair } = await graphqlProvider.query<PairResultType>(
                createPairQuery,
                variables
            );

            // Check if the pair creation returned valid transactions
            if (!createPair.noAuthTransactions) {
                throw new Error("No route found for creating pair");
            }

            // Process each transaction in the pair creation response
            const txURLs = await Promise.all(
                createPair.noAuthTransactions.map(async (transaction) => {
                    const txToBroadcast = { ...transaction };
                    txToBroadcast.sender = address;
                    txToBroadcast.data = TransactionPayload.fromEncoded(
                        transaction.data as unknown as string
                    );

                    // Get the account data and set the transaction nonce
                    const account = await walletProvider.getAccount(
                        walletProvider.getAddress()
                    );
                    txToBroadcast.nonce = account.nonce;

                    // Create a new transaction object and sign it
                    const tx = new Transaction(txToBroadcast);
                    const signature = await walletProvider.signTransaction(tx);
                    tx.applySignature(signature);

                    // Send the transaction and get the transaction hash
                    const txHash = await walletProvider.sendTransaction(tx);

                    // Return the URL to view the transaction
                    return walletProvider.getTransactionURL(txHash);
                })
            );

            // Join the transaction URLs into a single string
            const transactionURLs = txURLs.join(",");

            // Call the callback with the success message and transaction URLs
            callback?.({
                text: `Transaction(s) sent successfully! You can view them here: ${transactionURLs}.`,
            });

            return true;
        } catch (error) {
            elizaLogger.error(
                    "Error during pair creation:",
                    JSON.stringify(error.message, null, 2)
                );
            console.log("Full error:", error)

            return false;
        }
    },

    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Create a pair with 1 EGLD and 100 USDC",
                },
            },
            {
                user: "{{agent}}",
                content: {
                    text: "Creating a pair with 1 EGLD and 100 USDC...",
                },
            },
        ],
    ] as ActionExample[][],
} as Action;
