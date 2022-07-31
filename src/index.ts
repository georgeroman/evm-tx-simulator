import { BigNumberish } from "@ethersproject/bignumber";
import { JsonRpcProvider } from "@ethersproject/providers";

import { getHandlers } from "./handlers";
import { bn } from "./utils";

import type { CallTrace, GlobalState } from "./types";

const parseCallTrace = (state: GlobalState, trace: CallTrace) => {
  if (trace.type === "CALL") {
    const handlers = getHandlers(trace);
    for (const { handle } of handlers) {
      handle(state, trace);
    }

    for (const call of trace.calls ?? []) {
      parseCallTrace(state, call);
    }
  }
};

type TxData = {
  from: string;
  to: string;
  data: string;
  value: BigNumberish;
};

export const simulateTx = async (
  tx: TxData,
  provider: JsonRpcProvider
): Promise<GlobalState> => {
  const trace: CallTrace = await provider.send("debug_traceCall", [
    {
      ...tx,
      value: bn(tx.value).toHexString(),
    },
    "latest",
    {
      tracer: "callTracer",
    },
  ]);

  const state = {};
  parseCallTrace(state, trace);

  return state;
};
