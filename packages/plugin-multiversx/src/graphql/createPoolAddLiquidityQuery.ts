import { gql } from "graphql-request";

const createPoolAddLiquidityString = `
  query createPoolAddLiquidity($tolerance: Float!, $pairAddress: String!, $tokens: [InputTokenModel!]!) {
    addLiquidityBatch(tokens: $tokens, tolerance: $tolerance, pairAddress: $pairAddress) {
      value
      receiver
      gasPrice
      gasLimit
      data
      chainID
      version
    }
  }
`;


export const createPoolAddLiquidityQuery = gql`
    ${createPoolAddLiquidityString}
`;