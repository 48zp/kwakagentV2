import { gql } from "graphql-request";

const createPoolFilterWithoutLpString = `
  query createPoolFilterWithoutLp($firstTokenID: String!, $secondTokenID: String!) {
    filteredPairs(filters: { issuedLpToken: false, firstTokenID: $firstTokenID, secondTokenID: $secondTokenID }, pagination: { first: 1 }) {
      edges {
        node {
          address
          state
        }
      }
    }
  }
`;


export const createPoolFilterWithoutLpQuery = gql`
    ${createPoolFilterWithoutLpString}
`;