import { gql } from "graphql-request";

const createPoolCreatePoolToken = `
  query createPoolCreatePoolToken($lpTokenName: String!, $lpTokenTicker: String!, $address: String!) {
    issueLPToken(lpTokenName: $lpTokenName, lpTokenTicker: $lpTokenTicker, address: $address) {
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

export const createPoolCreatePoolTokenQuery = gql`
    ${createPoolCreatePoolToken}
`;
