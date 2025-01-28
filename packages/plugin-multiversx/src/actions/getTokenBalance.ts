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
import { MVX_NETWORK_CONFIG } from "../constants";
import { filteredTokensQuery } from "../graphql/tokensQuery";
import { denominateAmount } from "../utils/amount";
import { isUserAuthorized } from "../utils/accessTokenManagement";
import { NativeAuthProvider } from "../providers/nativeAuth";
import { tokensDataSchema } from "../utils/schemas";

export interface IGetBalanceContent extends Content {
    address?: string;
}

type TokensData = {
    tokens: {
        identifier: string;
        balance: string;
        decimals: number;
    }[];
};

const getBalanceTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.

Example response:
\`\`\`json
{
    "address": "erd1xxxxxx..."
}
\`\`\`

{{recentMessages}}

Given the recent messages, extract the following information:
- Address to check the balance for. If not provided, use the agent's own address.

Respond with a JSON markdown block containing only the extracted values.`;

export default {
    name: "GET_BALANCE",
    similes: ["CHECK_BALANCE", "GET_TOKENS_BALANCE"],
    validate: async (runtime: IAgentRuntime, message: Memory) => {
        elizaLogger.log("Validating config for user:", message.userId);
        await validateMultiversxConfig(runtime);
        return true;
    },
    description: "Get balance for a given address or the agent's address",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback?: HandlerCallback
    ) => {
        elizaLogger.log("Starting GET_BALANCE handler...");

        if (!isUserAuthorized(message.userId, runtime)) {
            elizaLogger.error(
                "Unauthorized user attempted to check balance:",
                message.userId
            );
            if (callback) {
                callback({
                    text: "You do not have permission to check balances.",
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

        const getBalanceContext = composeContext({
            state,
            template: getBalanceTemplate,
        });

        const content = await generateObject({
            runtime,
            context: getBalanceContext,
            modelClass: ModelClass.SMALL,
            schema: tokensDataSchema,
        });

        const getBalanceContent = content.object as IGetBalanceContent;

        const address =
            getBalanceContent.address ||
            new WalletProvider(
                runtime.getSetting("MVX_PRIVATE_KEY"),
                runtime.getSetting("MVX_NETWORK")
            )
                .getAddress()
                .toBech32();

        try {
            const privateKey = runtime.getSetting("MVX_PRIVATE_KEY");
            const network = runtime.getSetting("MVX_NETWORK");
            const networkConfig = MVX_NETWORK_CONFIG[network];
            const walletProvider = new WalletProvider(privateKey, network);

            const nativeAuthProvider = new NativeAuthProvider({
                apiUrl: networkConfig.apiURL,
            });

            await nativeAuthProvider.initializeClient();

            const accessToken =
                await nativeAuthProvider.getAccessToken(walletProvider);

            const graphqlProvider = new GraphqlProvider(
                networkConfig.graphURL,
                { Authorization: `Bearer ${accessToken}` }
            );

            const tokensData: TokensData | null = await graphqlProvider.query(
                filteredTokensQuery,
                { address }
            );

            if (!tokensData || !tokensData.tokens) {
                throw new Error("Could not fetch balance data.");
            }

            const balances = tokensData.tokens.map((token: any) => ({
                token: token.ticker,
                balance: denominateAmount({
                    amount: token.balance.toString(),
                    decimals: token.decimals,
                }),
            }));

            callback?.({
                text: `Here is the balance for address ${address}:`,
                content: { balances },
            });

            return true;
        } catch (error) {
            elizaLogger.error("Error during balance retrieval:", error);
            callback?.({
                text: "Could not retrieve balance.",
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
                    text: "Check the balance for erd1xxxxxx...",
                },
            },
            {
                user: "{{agent}}",
                content: {
                    text: "Retrieving balance for address erd1xxxxxx...",
                },
            },
        ],
        [
            {
                user: "{{user2}}",
                content: {
                    text: "What is my balance?",
                },
            },
            {
                user: "{{agent}}",
                content: {
                    text: "Retrieving your balance...",
                },
            },
        ],
    ] as ActionExample[][],
} as Action;
