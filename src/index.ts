import { BigNumberish } from "@ethersproject/bignumber";
import { JsonRpcProvider } from "@ethersproject/providers";

import { getHandlers } from "./handlers";
import { hex } from "./utils";

import type { CallTrace, GlobalState } from "./types";

type TxData = {
  from: string;
  to: string;
  data: string;
  value: BigNumberish;
  gas?: BigNumberish;
  gasPrice?: BigNumberish;
  balanceOverrides?: {
    [address: string]: BigNumberish;
  };
};

export const getCallTrace = async (
  tx: TxData,
  provider: JsonRpcProvider
): Promise<CallTrace> => {
  const trace: CallTrace = await provider.send("debug_traceCall", [
    {
      ...tx,
      value: hex(tx.value),
      gas: tx.gas && hex(tx.gas),
      gasPrice: tx.gasPrice && hex(tx.gasPrice),
    },
    "latest",
    {
      tracer: "callTracer",
      stateOverrides:
        tx.balanceOverrides &&
        Object.fromEntries(
          Object.entries(tx.balanceOverrides).map(([address, balance]) => [
            address,
            { balance: hex(balance) },
          ])
        ),
    },
  ]);

  if (trace.error) {
    throw new Error("execution-reverted");
  }

  return trace;
};

export const getTransactionTrace = async (
  txHash: string,
  provider: JsonRpcProvider
): Promise<CallTrace> => {
  const trace: CallTrace = await provider.send("debug_traceTransaction", [
    txHash,
    { tracer: "callTracer" },
  ]);

  if (trace.error) {
    throw new Error("execution-reverted");
  }

  return trace;
};

const internalParseCallTrace = (state: GlobalState, trace: CallTrace) => {
  if (!trace.error) {
    if (trace.type === "CALL") {
      const handlers = getHandlers(trace);
      for (const { handle } of handlers) {
        handle(state, trace);
      }
    }

    if (trace.type === "CALL" || trace.type === "DELEGATECALL") {
      for (const call of trace.calls ?? []) {
        internalParseCallTrace(state, call);
      }
    }
  }
};

export const parseCallTrace = (trace: CallTrace) => {
  const state = {};
  internalParseCallTrace(state, trace);

  return state;
};

// For testing only
// const main = async () => {
//   const provider = new JsonRpcProvider(process.env.RPC_URL);
//   const result = await getTransactionTrace(
//     "0x6822010a3c0963e31459a65e90f780d4928cd01c9ef8798e42ec9daba576c4b8",
//     provider
//   );
//   console.log(parseCallTrace(result));
// };
// main();
