import { gql } from "graphql-request";

const createPoolSetInitialExchangeRateString = `
  query createPoolSetInitialExchangeRate($pairAddress: String!, $tokens: [InputTokenModel!]!, $tolerance: Float!) {
    addInitialLiquidityBatch(pairAddress: $pairAddress, tokens: $tokens, tolerance: $tolerance) {
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


export const createPoolSetInitialExchangeRateQuery = gql`
    ${createPoolSetInitialExchangeRateString}
`;