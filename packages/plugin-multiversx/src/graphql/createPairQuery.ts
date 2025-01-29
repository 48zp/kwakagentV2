import { gql } from "graphql-request";

const createPairString = `
  query createPair($firstTokenID: String!, $secondTokenID: String!) {
    createPair(firstTokenID: $firstTokenID, secondTokenID: $secondTokenID) {
      nonce
      sender
      receiver
      data
      gasLimit
      chainID
    }
  }
`;

export const createPairQuery = gql`
    ${createPairString}
`;