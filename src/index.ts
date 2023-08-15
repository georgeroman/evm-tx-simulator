import { BigNumberish } from "@ethersproject/bignumber";
import { JsonRpcProvider } from "@ethersproject/providers";
import axios from "axios";

import { getHandlers } from "./handlers";
import { hex } from "./utils";
import { parseLogsFromTrace, LoggerTrace } from "./opcode";

import type { CallTrace, CallType, Log, Payment, StateChange } from "./types";

type Call = {
  from: string;
  to: string;
  data: string;
  value: BigNumberish;
  gas: BigNumberish;
  gasPrice: BigNumberish;
  balanceOverrides?: {
    [address: string]: BigNumberish;
  };
  blockOverrides?: {
    number?: number;
    timestamp?: number;
  };
};

export const getCallResult = async (
  call: Call,
  provider: JsonRpcProvider
): Promise<any> => {
  if (call.blockOverrides) {
    throw new Error("Block overrides not supported");
  }

  return provider.send("eth_call", [
    {
      ...call,
      value: hex(call.value),
      gas: hex(call.gas),
      gasPrice: hex(call.gasPrice),
    },
    "latest",
    call.balanceOverrides &&
      Object.fromEntries(
        Object.entries(call.balanceOverrides).map(([address, balance]) => [
          address,
          { balance: hex(balance) },
        ])
      ),
  ]);
};

export const getCallTrace = async (
  call: Call,
  provider: JsonRpcProvider,
  options?: {
    skipReverts?: boolean;
    includeLogs?: boolean;
  }
): Promise<CallTrace> => {
  const trace: CallTrace = await provider.send("debug_traceCall", [
    {
      ...call,
      value: hex(call.value),
      gas: hex(call.gas),
      gasPrice: hex(call.gasPrice),
    },
    "latest",
    {
      tracer: "callTracer",
      tracerConfig: options?.includeLogs ? { withLog: true } : undefined,
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

export const getCallTraceLogs = async (
  call: Call,
  provider: JsonRpcProvider,
  options?: {
    method: "withLog" | "customTrace" | "opcodeLogger";
  }
): Promise<Log[]> => {
  const method = options?.method ?? "customTrace";

  const customTrace = `
    {
      logs: [],
      reverted: false,
      byte2Hex: function (byte) {
        if (byte < 0x10) {
          return '0' + byte.toString(16);
        }
        return byte.toString(16);
      },
      arrayToHex: function (array) {
        var value = '';
        for (var i = 0; i < array.length; i++) {
          value += this.byte2Hex(array[i]);
        }
        return '0x' + value;
      },
      step: function (log) {
        var topicCount = (log.op.toString().match(/LOG(\\d)/) || [])[1];
        if (topicCount) {
          var result = {
            address: this.arrayToHex(log.contract.getAddress()),
            data: this.arrayToHex(log.memory.slice(parseInt(log.stack.peek(0)), parseInt(log.stack.peek(0)) + parseInt(log.stack.peek(1)))),
            topics: []
          };
          for (var i = 0; i < topicCount; i++) {
            result.topics.push('0x' + log.stack.peek(i + 2).toString(16).padStart(64, '0'));
          }
          this.logs.push(result);
        }
      },
      fault: function (log) {
        this.reverted = true;
      },
      result: function () {
        return {
          logs: this.logs,
          reverted: this.reverted
        };
      }
    }
  `;

  const trace: any = await provider.send("debug_traceCall", [
    {
      ...call,
      value: hex(call.value),
      gas: hex(call.gas),
      gasPrice: hex(call.gasPrice),
    },
    "latest",
    {
      tracer: method === "opcodeLogger" ? undefined : (method === "withLog" ? "callTracer" : customTrace),
      tracerConfig: method === "opcodeLogger" ? undefined : method === "withLog" ? { withLog: true } : undefined,
      enableMemory: ["customTrace", "opcodeLogger"].includes(method) ? true : undefined,
      enableReturnData: method === "customTrace" ? true : undefined,
      disableStorage: method === "customTrace" ? true : undefined,
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

  if (method === "opcodeLogger") {
    const loggerTrace = trace as LoggerTrace;
    const parsedLogs = parseLogsFromTrace(call.to, loggerTrace);
    return parsedLogs;
  } else if (method === "withLog") {
    const typedTrace = trace as CallTrace;

    const getLogs = (call: CallTrace): Log[] => {
      if (call.error) {
        throw new Error("execution-reverted");
      }

      const logs: Log[] = [];
      for (const c of call.calls ?? []) {
        logs.push(...getLogs(c));
      }
      logs.push(...(call.logs ?? []));

      return logs;
    };

    return getLogs(typedTrace);
  } else {
    const typedTrace = trace as {
      logs: Log[];
      reverted: boolean;
    };

    if (typedTrace.reverted) {
      throw new Error("execution-reverted");
    }

    return typedTrace.logs;
  }
};

type Tx = {
  hash: string;
};

export const getTxTraces = async (
  txs: Tx[],
  provider: JsonRpcProvider
): Promise<{ [txHash: string]: CallTrace }> => {
  const results = await axios
    .post(
      provider.connection.url,
      txs.map((tx, i) => ({
        method: "debug_traceTransaction",
        params: [tx.hash, { tracer: "callTracer" }],
        jsonrpc: "2.0",
        id: i,
      })),
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    )
    .then((response) => response.data as { id: number; result: CallTrace }[]);

  return Object.fromEntries(
    results.map(({ id, result }) => [txs[id].hash, result])
  );
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
