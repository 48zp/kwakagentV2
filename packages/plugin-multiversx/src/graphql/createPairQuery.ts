import { gql } from "graphql-request";

const transactionsPlaceholder = "TRANSACTIONS_PLACEHOLDER";

const transactionAttributes = `
  value
  receiver
  gasPrice
  gasLimit
  data
  chainID
  version
`;

const transactionsString = `
  noAuthTransactions(sender: $sender) {
    ${transactionAttributes}
  }
`;

const createPairString = `
  query createPair(
    $firstTokenID: String!
    $secondTokenID: String!
    $sender: String!
  ) {
    createPair(
      firstTokenID: $firstTokenID
      secondTokenID: $secondTokenID
    ) {
      firstTokenID
      secondTokenID

      ${transactionsPlaceholder}
    }
  }
`;

export const createPairQuery = gql`
    ${createPairString.replace(transactionsPlaceholder, transactionsString)}
`;
