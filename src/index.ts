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

// For keeping the state across recursive calls
let _nth = 0;

export const searchForCall = (
  trace: CallTrace,
  options: { to?: string; type?: CallType; sigHashes?: string[] },
  nth = 0
): CallTrace | undefined => {
  _nth = nth;

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
  if (trace.error) {
    match = false;
  }

  if (match) {
    if (_nth === 0) {
      return trace;
    } else {
      _nth--;
    }
  }

  if (!trace.error) {
    for (const call of trace.calls ?? []) {
      const result = searchForCall(call, options, _nth);
      if (result) {
        return result;
      }
    }
  }
};
