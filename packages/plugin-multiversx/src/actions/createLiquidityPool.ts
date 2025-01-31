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
import { poolSchema } from "../utils/schemas";
import { MVX_NETWORK_CONFIG } from "../constants";
import { getRawAmount } from "../utils/amount";
import {
    createPairQuery,
    createPoolCreatePoolTokenQuery,
    createPoolSetLocalRolesQuery,
    createPoolFilterWithoutLpQuery,
    createPoolSetInitialExchangeRateQuery,
    lockTokensQuery,
    setSwapEnabledByUserQuery,
} from "../graphql/createLiquidityPoolQueries";
import { NativeAuthProvider } from "../providers/nativeAuth";
import { isUserAuthorized } from "../utils/accessTokenManagement";
import {
    FungibleTokenOfAccountOnNetwork,
    Transaction,
    TransactionPayload,
} from "@multiversx/sdk-core/out";
import {
    TransactionWatcher,
    ApiNetworkProvider,
    Account,
} from "@multiversx/sdk-core";
export interface ICreatePoolContent extends Content {
    baseTokenID: string;
    quoteTokenID: string;
    baseAmount: string;
    quoteAmount: string;
}

const poolTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.

Example response:
\`\`\`json
{
    "baseTokenID": "KWAK",
    "quoteTokenID": "EGLD",
    "baseAmount": "1000000",
    "quoteAmount": "20"
}
\`\`\`

{{recentMessages}}

Given the recent messages, extract the following information about the requested pair creation:
- Token A
- Token B
- Amount Token A
- Amount Token B

Respond with a JSON markdown block containing only the extracted values.`;

export default {
    name: "CREATE_POOL",
    similes: ["CREATE_PAIR", "CREATE_TOKEN_PAIR", "CREATE_LP"],
    validate: async (runtime: IAgentRuntime, message: Memory) => {
        elizaLogger.log("Validating config for user:", message.userId);
        await validateMultiversxConfig(runtime);
        return true;
    },
    description: "Create a liquidity pool of tokens",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback?: HandlerCallback
    ) => {
        elizaLogger.log("Starting CREATE_POOL handler...");

        // Check user authorization
        if (!isUserAuthorized(message.userId, runtime)) {
            elizaLogger.error(
                "Unauthorized user attempted to create a liquidity pool:",
                message.userId
            );
            if (callback) {
                callback({
                    text: "You do not have permission to create a liquidity pool.",
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

        // Generate pool context
        const poolContext = composeContext({
            state,
            template: poolTemplate,
        });

        const content = await generateObject({
            runtime,
            context: poolContext,
            modelClass: ModelClass.SMALL,
            schema: poolSchema,
        });

        const poolContent = content.object as ICreatePoolContent;

        // Validate pool content
        if (
            !poolContent.baseTokenID ||
            !poolContent.quoteTokenID ||
            !poolContent.baseAmount ||
            !poolContent.quoteAmount ||
            typeof poolContent.baseTokenID !== "string" ||
            typeof poolContent.quoteTokenID !== "string" ||
            typeof poolContent.baseAmount !== "string" ||
            typeof poolContent.quoteAmount !== "string"
        ) {
            elizaLogger.error("Invalid content for CREATE_POOL action.");

            callback?.({
                text: "Unable to process liquidity pool creation request. Invalid content provided.",
                content: { error: "Invalid liquidity pool content" },
            });

            return false;
        }

        try {
            // Retrieve settings and initialize providers
            const privateKey = runtime.getSetting("MVX_PRIVATE_KEY");
            const network = runtime.getSetting("MVX_NETWORK");
            const networkConfig = MVX_NETWORK_CONFIG[network];

            const walletProvider = new WalletProvider(privateKey, network);

            const apiNetworkProvider = new ApiNetworkProvider(
                networkConfig.apiURL,
                {
                    clientName: "ElizaOs",
                }
            );

            const config = {
                origin: "https://devnet.xexchange.com",
                apiUrl: networkConfig.apiURL,
            };

            const isEGLD = poolContent.baseTokenID.toLowerCase() === "egld";

            const hasEgldBalance = await walletProvider.hasEgldBalance(
                isEGLD ? poolContent.baseTokenID : undefined
            );

            if (!hasEgldBalance) {
                throw new Error("Insufficient EGLD balance.");
            }

            const nativeAuthProvider = new NativeAuthProvider(config);
            await nativeAuthProvider.initializeClient();

            const address = walletProvider.getAddress().toBech32();
            const accessToken =
                await nativeAuthProvider.getAccessToken(walletProvider);

            const graphqlProvider = new GraphqlProvider(
                networkConfig.graphURL,
                { Authorization: `Bearer ${accessToken}` }
            );

            function normalizeIdentifier(identifier: string): string {
                return identifier.split("-")[0].toUpperCase();
            }

            async function findTokenIdentifier(
                ticker: string
            ): Promise<string | null> {
                try {
                    const tokenData = await walletProvider.getTokensData();

                    const normalizedTicker = normalizeIdentifier(ticker);

                    const token = tokenData.find(
                        (token) =>
                            token.identifier &&
                            normalizeIdentifier(token.identifier) ===
                                normalizedTicker
                    );

                    if (token) {
                        return token.identifier;
                    } else {
                        elizaLogger.error(
                            "Token not found for ticker:",
                            ticker
                        );
                        return null;
                    }
                } catch (error) {
                    elizaLogger.error("Error finding token identifier:", error);
                    return null;
                }
            }

            // Step 1: Create Pair

            let tokenData: FungibleTokenOfAccountOnNetwork = null;
            let baseToken = poolContent.baseTokenID;
            let quoteToken = poolContent.quoteTokenID;
            let quoteTokenIdentifier: string | undefined;
            let baseTokenIdentifier: string | undefined;

            if (!isEGLD) {
                baseTokenIdentifier = await findTokenIdentifier(baseToken);

                if (!baseTokenIdentifier) {
                    throw new Error("Base token identifier not found");
                }

                if (quoteToken.toLowerCase() !== "egld") {
                    quoteTokenIdentifier =
                        await findTokenIdentifier(quoteToken);

                    if (!quoteTokenIdentifier) {
                        throw new Error("Quote token identifier not found");
                    }
                }

                tokenData =
                    await walletProvider.getTokenData(baseTokenIdentifier);

                const rawBalance = getRawAmount({
                    amount: tokenData.balance.toString(),
                    decimals: tokenData.rawResponse.decimals,
                });
                const rawBalanceNum = Number(rawBalance);

                if (rawBalanceNum < Number(poolContent.baseAmount)) {
                    throw new Error("Insufficient balance");
                }
            } else {
                quoteTokenIdentifier = networkConfig.wrappedEgldIdentifier;
            }

            if (quoteToken.toLowerCase() === "egld") {
                quoteTokenIdentifier = networkConfig.wrappedEgldIdentifier;
            }

            const createPairVariables = {
                firstTokenID: baseTokenIdentifier,
                secondTokenID: quoteTokenIdentifier,
            };

            const { createPair } = await graphqlProvider.query<any>(
                createPairQuery,
                createPairVariables
            );

            if (!createPair) {
                throw new Error(
                    "Pair creation failed. No response from GraphQL."
                );
            }

            // Prepare and send the transaction
            const createPairTxToBroadcast = {
                sender: address,
                data: TransactionPayload.fromEncoded(createPair.data),
                nonce: await walletProvider
                    .getAccount(walletProvider.getAddress())
                    .then((account) => account.nonce),
                gasLimit: createPair.gasLimit,
                receiver: createPair.receiver,
                chainID: createPair.chainID,
            };

            const createPairTx = new Transaction(createPairTxToBroadcast);
            const createPairsignature =
                await walletProvider.signTransaction(createPairTx);
            createPairTx.applySignature(createPairsignature);

            const createPairTxHash =
                await walletProvider.sendTransaction(createPairTx);
            const createPairTxURL =
                walletProvider.getTransactionURL(createPairTxHash);

            elizaLogger.log("createPair transaction sent successfully");
            elizaLogger.log(`Transaction URL: ${createPairTxURL}`); // View Transaction

            const createPairWatcher = new TransactionWatcher(
                apiNetworkProvider
            );
            const createPairTransactionOnNetwork =
                await createPairWatcher.awaitCompleted(createPairTx);

            if (
                "status" in createPairTransactionOnNetwork.status &&
                createPairTransactionOnNetwork.status.status === "success"
            ) {
                elizaLogger.log(
                    "createPair transaction success, issuing LP Token.."
                );
                callback?.({
                    text: `createPair transaction success, issuing LP Token..`,
                });
            } else {
                elizaLogger.log("createPair transaction failed.");
                callback?.({
                    text: `createPair transaction failed.`,
                });
            }

            // Step 2: Issue LP Token

            // Create LP Token name and ticker
            const baseTokenSymbol = baseTokenIdentifier.split("-")[0];
            const quoteTokenSymbol = quoteTokenIdentifier.split("-")[0];
            const lpTokenName = `${baseTokenSymbol}${quoteTokenSymbol}LP`;
            const lpTokenTicker = `${baseTokenSymbol}${quoteTokenSymbol}`;

            const response = await graphqlProvider.query<any>(
                createPoolFilterWithoutLpQuery,
                {
                    firstTokenID: baseTokenIdentifier,
                    secondTokenID: quoteTokenIdentifier,
                }
            );

            const scAddress =
                response?.filteredPairs?.edges?.[0]?.node?.address || null;

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

            // Prepare and send the transaction
            const issueLPTokenBroadcast = {
                sender: address,
                receiver: issueLPToken.receiver,
                data: TransactionPayload.fromEncoded(issueLPToken.data),
                value: 50000000000000000,
                nonce: await walletProvider
                    .getAccount(walletProvider.getAddress())
                    .then((account) => account.nonce),
                gasLimit: issueLPToken.gasLimit,
                chainID: issueLPToken.chainID,
            };

            const issueLPTokenTx = new Transaction(issueLPTokenBroadcast);
            const issueLPTokenSignature =
                await walletProvider.signTransaction(issueLPTokenTx);
            issueLPTokenTx.applySignature(issueLPTokenSignature);

            const issueLPTokenTxHash =
                await walletProvider.sendTransaction(issueLPTokenTx);
            const issueLPTokenTxURL =
                walletProvider.getTransactionURL(issueLPTokenTxHash);

            elizaLogger.log("issueLpToken transaction sent successfully");
            elizaLogger.log(`Transaction URL: ${issueLPTokenTxURL}`); // View Transaction

            const issueLPTokenWatcher = new TransactionWatcher(
                apiNetworkProvider
            );
            const issueLPTokenTransactionOnNetwork =
                await issueLPTokenWatcher.awaitCompleted(issueLPTokenTx);

            if (
                "status" in issueLPTokenTransactionOnNetwork.status &&
                issueLPTokenTransactionOnNetwork.status.status === "success"
            ) {
                elizaLogger.log(
                    "issueLpToken transaction success, setting Local Roles.."
                );
                callback?.({
                    text: `issueLpToken transaction success, setting Local Roles..`,
                });
            } else {
                elizaLogger.log("issueLpToken transaction failed.");
                callback?.({
                    text: `issueLpToken transaction failed.`,
                });
            }

            return true;
        } catch (error) {
            elizaLogger.error("Error during liquidity pool creation:", error.message);

            callback?.({
                text: "An error occurred while creating the liquidity pool.",
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
                    text: "I want to create a liquidity pool with one million Kwak and twenty EGLD.",
                },
            },
            {
                user: "{{agent}}",
                content: {
                    text: "Creating a liquidity pool with 1,000,000 Kwak and 20 EGLD...",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Can you set up a pool for 500,000 KWAK and 10 EGLD?",
                },
            },
            {
                user: "{{agent}}",
                content: {
                    text: "Initializing a liquidity pool with 500K Kwak and 10 EGLD...",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "I'd like to create a new trading pair: 2M Kwak against 40 EGLD.",
                },
            },
            {
                user: "{{agent}}",
                content: {
                    text: "Setting up a new liquidity pool with 2,000,000 Kwak and 40 EGLD...",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Open a pool with one and a half million Kwak and thirty EGLD.",
                },
            },
            {
                user: "{{agent}}",
                content: {
                    text: "Creating a new pool with 1.5M Kwak and 30 EGLD...",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Set up a pool: 2.5 million Kwak and 50 EGLD.",
                },
            },
            {
                user: "{{agent}}",
                content: {
                    text: "Initializing a new pool with 2,500,000 Kwak and 50 EGLD...",
                },
            },
        ],
    ] as ActionExample[][],
} as Action;
