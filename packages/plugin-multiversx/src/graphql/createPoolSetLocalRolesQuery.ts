import { gql } from "graphql-request";

const createPoolSetLocalRolesString = `
  query createPoolSetLocalRoles($address: String!) {
    setLocalRoles(address: $address) {
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


export const createPoolSetLocalRolesQuery = gql`
    ${createPoolSetLocalRolesString}
`;