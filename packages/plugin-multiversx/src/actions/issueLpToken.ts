import {
    elizaLogger,
    type IAgentRuntime,
    type Memory,
    composeContext,
    generateObject,
    ModelClass,
    type Content,
    type Action,
    type ActionExample,
} from "@elizaos/core";
import { WalletProvider } from "../providers/wallet";
import { validateMultiversxConfig } from "../enviroment";
import { GraphqlProvider } from "../providers/graphql";
import { NativeAuthProvider } from "../providers/nativeAuth";
import { isUserAuthorized } from "../utils/accessTokenManagement";
import { Transaction, TransactionPayload } from "@multiversx/sdk-core";
import { MVX_NETWORK_CONFIG } from "../constants";
import { createPoolCreatePoolTokenQuery } from "../graphql/createPoolCreatePoolTokenQuery";
import { createPoolFilterWithoutLpQuery } from "../graphql/createPoolFilterWithoutLpQuery";
import { lpTokenSchema } from "../utils/schemas";

export interface IlpTokenContent extends Content {
    lpTokenName: string;
    lpTokenTicker: string;
    address: string;
}

const lpTokenTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.

Example response:
\`\`\`json
{
    "firstTokenID": "EGLD",
    "secondTokenID": "USDC",
    "txHash": "8b880a0be9ed6eeece2d743f573359bae5aaf3de8b92c6904ddeb2c423d81b02"
}
\`\`\`

{{recentMessages}}

Given the recent messages, extract the following information about the LP Token creation:
- Token A
- Token B
- Transaction hash

Respond with a JSON markdown block containing only the extracted values.`;

export default {
    name: "ISSUE_LP_TOKEN",
    similes: [
        "ISSUE_POOL_TOKEN",
        "CREATE_LP_TOKEN, CREATE_POOL_TOKEN",
        "ISSUEPOOL_TOKEN",
        "CREATELP_TOKEN, CREATEPOOL_TOKEN",
        "ISSUELP_TOKEN",
    ],
    description: "Issue a LP Token after pair creation",
    validate: async (runtime: IAgentRuntime, message: Memory) => {
        elizaLogger.log("Validating config for user:", message.userId);
        await validateMultiversxConfig(runtime);
        return true;
    },
    handler: async (
        runtime: any,
        message: any,
        state: any,
        _options: { [key: string]: unknown },
        callback?: any
    ) => {
        elizaLogger.log("Starting ISSUE_LP_TOKEN handler...");

        // Check user authorization
        if (!isUserAuthorized(message.userId, runtime)) {
            elizaLogger.error(
                "Unauthorized user attempted to create LP Token:",
                message.userId
            );
            if (callback) {
                callback({
                    text: "You do not have permission to create a LP Token.",
                    content: { error: "Unauthorized user" },
                });
            }
            return false;
        }

        // Compose or update state
        if (!state) {
            state = (await runtime.composeState(message)) as any;
        } else {
            state = await runtime.updateRecentMessageState(state);
        }

        // Generate issueLpToken context
        const lpTokenContext = composeContext({
            state,
            template: lpTokenTemplate,
        });

        const content = await generateObject({
            runtime,
            context: lpTokenContext,
            modelClass: ModelClass.SMALL,
            schema: lpTokenSchema,
        });

        const lpTokenContent = content.object as IlpTokenContent;

        // Validate lp token content
        if (
            !lpTokenContent.firstTokenID ||
            !lpTokenContent.secondTokenID ||
            !lpTokenContent.txHash ||
            typeof lpTokenContent.firstTokenID !== "string" ||
            typeof lpTokenContent.secondTokenID !== "string" ||
            typeof lpTokenContent.txHash !== "string"
        ) {
            elizaLogger.error("Invalid content for ISSUE_LP_TOKEN action.");

            callback?.({
                text: "Unable to process issue lp token request. Invalid content provided.",
                content: { error: "Invalid lp token content" },
            });

            return false;
        }

        // Create LP Token name and ticker
        const lpTokenName = `${lpTokenContent.firstTokenID.replace("-", "")}${lpTokenContent.secondTokenID.replace("-", "")}LP`;
        const lpTokenTicker = `${lpTokenContent.firstTokenID.replace("-", "")}${lpTokenContent.secondTokenID.replace("-", "")}`;

        // =============================================================================================
        // A partir d'ici, il faut trouver le moyen d'extraire le smart contract en appellant l'api tx: config.apiURL/txHash
        // =============================================================================================

        try {
            // Configure and initialize providers
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

            const response = await graphqlProvider.query<any>(
                createPoolFilterWithoutLpQuery,
                {
                    firstTokenID: lpTokenContent.firstTokenID,
                    secondTokenID: lpTokenContent.secondTokenID,
                }
            );

            const scAddress =
                response?.filteredPairs?.edges?.[0]?.node?.address || null;

            // Exécuter la requête GraphQL pour émettre le LP Token
            const { issueLPToken } = await graphqlProvider.query<any>(
                createPoolCreatePoolTokenQuery,
                {
                    lpTokenName: lpTokenName,
                    lpTokenTicker: lpTokenTicker,
                    address: scAddress,
                }
            );

            if (!issueLPToken) {
                throw new Error(
                    "LP Token creation failed. No response from GraphQL."
                );
            }

            // Afficher la réponse de l'issueLPToken
            console.log("issueLPToken GraphQL response:", issueLPToken);

            // Préparer la transaction pour l'émettre
            const txToBroadcast = {
                sender: address,
                receiver: issueLPToken.receiver,
                data: TransactionPayload.fromEncoded(issueLPToken.data),
                nonce: await walletProvider
                    .getAccount(walletProvider.getAddress())
                    .then((account) => account.nonce),
                gasLimit: issueLPToken.gasLimit,
                chainID: issueLPToken.chainID,
            };

            const tx = new Transaction(txToBroadcast);
            const signature = await walletProvider.signTransaction(tx);
            tx.applySignature(signature);

            const txHash = await walletProvider.sendTransaction(tx);
            const txURL = walletProvider.getTransactionURL(txHash); // Transaction URL

            callback?.({
                text: `LP Token issued successfully! You can view the transaction here: ${txURL}.`,
            });

            return true;
        } catch (error) {
            elizaLogger.error("Error during LP Token creation:", error.message);
            console.log("Full error:", error);

            callback?.({
                text: "An error occurred while creating the LP Token.",
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
                    text: "Issue the LP Token for the pair EGLD and USDC and the transaction hash 8b880a0be9ed6eeece2d743f573359bae5aaf3de8b92c6904ddeb2c423d81b02",
                },
            },
            {
                user: "{{agent}}",
                content: {
                    text: "Issuing LP token for EGLD and USDC...",
                },
            },
        ],
    ] as ActionExample[][],
} as Action;