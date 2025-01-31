import { gql } from "graphql-request";

const lockTokensString = `
  query ($inputTokens: InputTokenModel!, $lockEpochs: Float!, $simpleLockAddress: String!) {
    lockTokens(inputTokens: $inputTokens, lockEpochs: $lockEpochs, simpleLockAddress: $simpleLockAddress) {
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


export const lockTokensQuery = gql`
    ${lockTokensString}
`;