import { BigNumberish } from "@ethersproject/bignumber";
import { JsonRpcProvider } from "@ethersproject/providers";

import { getHandlers } from "./handlers";
import { hex } from "./utils";

import type { CallTrace, CallType, GlobalState } from "./types";

type Call = {
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
  call: Call,
  provider: JsonRpcProvider
): Promise<CallTrace> => {
  const trace: CallTrace = await provider.send("debug_traceCall", [
    {
      ...call,
      value: hex(call.value),
      gas: call.gas !== undefined && hex(call.gas),
      gasPrice: call.gasPrice !== undefined && hex(call.gasPrice),
    },
    "latest",
    {
      tracer: "callTracer",
      stateOverrides:
        call.balanceOverrides &&
        Object.fromEntries(
          Object.entries(call.balanceOverrides).map(([address, balance]) => [
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

type Tx = {
  hash: string;
};

export const getTxTrace = async (
  tx: Tx,
  provider: JsonRpcProvider
): Promise<CallTrace> => {
  const trace: CallTrace = await provider.send("debug_traceTransaction", [
    tx.hash,
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

export const parseCallTrace = (trace: CallTrace): GlobalState => {
  const state = {};
  internalParseCallTrace(state, trace);

  return state;
};

export const searchForCall = (
  trace: CallTrace,
  options: { to?: string; type?: CallType; sigHashes?: string[] },
  nth = 0
): CallTrace | undefined => {
  let match = true;
  if (options.to && trace.to !== options.to) {
    match = false;
  }
  if (options.type && trace.type !== options.type) {
    match = false;
  }
  if (
    options.sigHashes &&
    !options.sigHashes.includes(trace.input.slice(0, 10))
  ) {
    match = false;
  }

  if (match) {
    if (nth === 0) {
      return trace;
    } else {
      nth--;
    }
  }

  for (const call of trace.calls ?? []) {
    const result = searchForCall(call, options, nth);
    if (result) {
      return result;
    }
  }
};

// For testing only
// const main = async () => {
//   const provider = new JsonRpcProvider(process.env.RPC_URL);
//   const result = await getTxTrace(
//     {
//       hash: "0x6822010a3c0963e31459a65e90f780d4928cd01c9ef8798e42ec9daba576c4b8",
//     },
//     provider
//   );
//   console.log(parseCallTrace(result));
// };
// main();
