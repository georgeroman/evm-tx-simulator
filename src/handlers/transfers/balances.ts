import { BigNumberish } from "@ethersproject/bignumber";

import { bn } from "../../utils";
import type { StateChange } from "../../types";

export const adjustBalance = (
  state: StateChange,
  data: {
    address: string;
    token: string;
    adjustment: BigNumberish;
  }
) => {
  let { address, token, adjustment } = data;

  address = address.toLowerCase();
  token = token.toLowerCase();

  if (!state[address]) {
    state[address] = {
      tokenBalanceState: {},
    };
  }
  if (!state[address].tokenBalanceState[token]) {
    state[address].tokenBalanceState[token] = "0";
  }

  state[address].tokenBalanceState[token] = bn(
    state[address].tokenBalanceState[token]
  )
    .add(adjustment)
    .toString();

  if (state[address].tokenBalanceState[token] === "0") {
    delete state[address].tokenBalanceState[token];
  }

  // TODO: Once new states are added, we shouldn't delete everything here
  if (!Object.keys(state[address].tokenBalanceState).length) {
    delete state[address];
  }
};
