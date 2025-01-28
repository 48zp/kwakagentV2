import type { Plugin } from "@elizaos/core";
import transfer from "./actions/transfer";
import createToken from "./actions/createToken";
import swap from "./actions/swap";
import createPair from "./actions/createPair";
import getTokenBalance from "./actions/getTokenBalance";

export const multiversxPlugin: Plugin = {
    name: "multiversx",
    description: "MultiversX Plugin for Eliza",
    actions: [transfer, createToken, swap, createPair, getTokenBalance],
    evaluators: [],
    providers: [],
};

export default multiversxPlugin;
