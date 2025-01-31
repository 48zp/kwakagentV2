import { gql } from "graphql-request";

const setSwapEnabledByUserString = `
  query ($inputTokens: InputTokenModel!) {
    setSwapEnabledByUser(inputTokens: $inputTokens) {
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


export const setSwapEnabledByUserQuery = gql`
    ${setSwapEnabledByUserString}
`;