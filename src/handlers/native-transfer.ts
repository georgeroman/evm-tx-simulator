import { AddressZero } from "@ethersproject/constants";

import { adjustBalance, CallTrace, GlobalState } from "../simulate";
import { bn } from "../utils";

export const handle = (state: GlobalState, trace: CallTrace) => {
  const value = bn(trace.value ?? 0);
  adjustBalance(state, `native:${AddressZero}`, trace.from, value.mul(-1));
  adjustBalance(state, `native:${AddressZero}`, trace.to, value);
};
