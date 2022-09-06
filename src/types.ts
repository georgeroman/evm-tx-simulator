export type CallType = "CALL" | "STATICCALL" | "DELEGATECALL";

export interface CallTrace {
  type: CallType;
  from: string;
  to: string;
  input: string;
  output: string;
  value?: string;
  error?: string;
  calls?: CallTrace[];
}

export type CallHandler = {
  selector?: string;
  handle: (state: GlobalState, trace: CallTrace) => void;
};

// Each `token` field below has the following format:
// - `native:${TOKEN_ADDRESS}` - used for native tokens (eg. ETH or MATIC)
// - `erc20:${TOKEN_ADDRESS}` - used for ERC20 tokens
// - `erc721:${TOKEN_ADDRESS}:${TOKEN_ID}` - used for ERC721 tokens
// - `erc1155:${TOKEN_ADDRESS}:${TOKEN_ID}` - used for ERC1155 tokens

// Mapping from token address to balance changes (in the context of an address state)
type TokenBalanceState = { [token: string]: string };

// State changes of a particular address
type AddressState = {
  tokenBalanceState: TokenBalanceState;
};

export type GlobalState = {
  [address: string]: AddressState;
};
