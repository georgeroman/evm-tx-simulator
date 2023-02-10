import { BigNumberish } from "@ethersproject/bignumber";
import { JsonRpcProvider } from "@ethersproject/providers";

import { getHandlers } from "./handlers";
import { hex } from "./utils";

import type { CallTrace, CallType, Payment, StateChange } from "./types";

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
  blockOverrides?: {
    number?: number;
    timestamp?: number;
  };
};

export const getCallTrace = async (
  call: Call,
  provider: JsonRpcProvider,
  options?: {
    skipReverts?: boolean;
  }
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
      blockOverrides: call.blockOverrides && {
        number: call.blockOverrides.number && hex(call.blockOverrides.number),
        time:
          call.blockOverrides.timestamp && hex(call.blockOverrides.timestamp),
      },
    },
  ]);

  if (!options?.skipReverts && trace.error) {
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

const internalParseCallTrace = (
  state: StateChange,
  payments: Payment[],
  trace: CallTrace
) => {
  if (!trace.error) {
    if (trace.type === "CALL") {
      const handlers = getHandlers(trace);
      for (const { handle } of handlers) {
        handle(state, payments, trace);
      }
    }

    if (trace.type === "CALL" || trace.type === "DELEGATECALL") {
      for (const call of trace.calls ?? []) {
        internalParseCallTrace(state, payments, call);
      }
    }
  }
};

export const getStateChange = (trace: CallTrace): StateChange => {
  const state: StateChange = {};
  internalParseCallTrace(state, [], trace);

  return state;
};

export const getPayments = (trace: CallTrace): Payment[] => {
  const payments: Payment[] = [];
  internalParseCallTrace({}, payments, trace);

  return payments;
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
