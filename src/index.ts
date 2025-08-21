import { BlockTag, JsonRpcProvider } from "@ethersproject/providers";
import axios from "axios";

import { getHandlers } from "./handlers";
import { parseLogsFromTrace } from "./opcode";
import { hex } from "./utils";

import type {
  Call,
  CallTrace,
  CallTraceOpenEthereum,
  CallType,
  Log,
  Payment,
  StateChange,
} from "./types";


export const getCallResult = async (
  call: Call,
  provider: JsonRpcProvider,
  block?: BlockTag
): Promise<any> => {
  if (call.blockOverrides) {
    throw new Error("Block overrides not supported");
  }

  return provider.send("eth_call", [
    {
      ...call,
      value: hex(call.value),
      gas: hex(call.gas),
      maxFeePerGas: hex(call.maxFeePerGas),
      maxPriorityFeePerGas: hex(call.maxPriorityFeePerGas),
    },
    block ? (typeof block === "number" ? hex(block) : block) : "latest",
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
    block?: BlockTag;
    skipReverts?: boolean;
    includeLogs?: boolean;
  }
): Promise<CallTrace> => {
  const trace: CallTrace = await provider.send("debug_traceCall", [
    {
      ...call,
      value: hex(call.value),
      gas: hex(call.gas),
      maxFeePerGas: hex(call.maxFeePerGas),
      maxPriorityFeePerGas: hex(call.maxPriorityFeePerGas),
    },
    options?.block
      ? typeof options.block === "number"
        ? hex(options.block)
        : options.block
      : "latest",
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
    throw new Error(`execution-reverted: ${JSON.stringify(trace.error)}`);
  }

  return normalizeTrace(trace);
};

export const getCallTraces = async (
  calls: Call[],
  provider: JsonRpcProvider,
  block?: BlockTag
) => {
  if (calls.some((call) => call.blockOverrides)) {
    throw new Error("Block overrides not supported");
  }

  if (calls.some((call) => call.balanceOverrides)) {
    throw new Error("Balance overrides not supported");
  }

  const results: { trace: CallTraceOpenEthereum[] }[] = await provider.send(
    "trace_callMany",
    [
      calls.map((call) => [
        {
          ...call,
          value: hex(call.value),
          gas: hex(call.gas),
          maxFeePerGas: hex(call.maxFeePerGas),
          maxPriorityFeePerGas: hex(call.maxPriorityFeePerGas),
        },
        ["trace"],
      ]),
      block ? (typeof block === "number" ? hex(block) : block) : "latest",
      ,
    ]
  );

  return results.map((r) =>
    normalizeTrace(internalMapToGethTraceFormat(r.trace))
  );
};

export const getCallTraceLogs = async (
  call: Call,
  provider: JsonRpcProvider,
  options?: {
    block?: BlockTag;
    method?: "withLog" | "customTrace" | "opcodeTrace";
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
      maxFeePerGas: hex(call.maxFeePerGas),
      maxPriorityFeePerGas: hex(call.maxPriorityFeePerGas),
    },
    options?.block
      ? typeof options.block === "number"
        ? hex(options.block)
        : options.block
      : "latest",
    {
      tracer:
        method === "opcodeTrace"
          ? undefined
          : method === "withLog"
          ? "callTracer"
          : customTrace,
      tracerConfig:
        method === "opcodeTrace"
          ? undefined
          : method === "withLog"
          ? { withLog: true }
          : undefined,
      enableMemory: ["customTrace", "opcodeTrace"].includes(method)
        ? true
        : undefined,
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

  if (method === "opcodeTrace") {
    return parseLogsFromTrace(call.to, trace);
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

export const getBlockTraces = async (
  block: number,
  provider: JsonRpcProvider
): Promise<{ [txHash: string]: CallTrace }> => {
  const results = await axios
    .post(
      provider.connection.url,
      {
        method: "debug_traceBlockByNumber",
        params: [hex(block), { tracer: "callTracer" }],
        jsonrpc: "2.0",
        id: 1,
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    )
    .then(
      (response) =>
        response.data.result as { txHash: string; result: CallTrace }[]
    );

  return Object.fromEntries(
    results.map(({ txHash, result }) => [txHash, normalizeTrace(result)])
  );
};

export const getTxTraces = async (
  txs: Tx[],
  provider: JsonRpcProvider
): Promise<{ [txHash: string]: CallTrace }> => {
  if (txs.length === 1) {
    const { result } = await axios
      .post(
        provider.connection.url,
        {
          method: "debug_traceTransaction",
          params: [txs[0].hash, { tracer: "callTracer" }],
          jsonrpc: "2.0",
          id: 1,
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      )
      .then((response) => response.data as { result: CallTrace });

    return {
      [txs[0].hash]: normalizeTrace(result),
    };
  } else {
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
      results.map(({ id, result }) => [txs[id].hash, normalizeTrace(result)])
    );
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

export const searchForCalls = (
  trace: CallTrace,
  options: { to?: string; type?: CallType; sigHashes?: string[] }
): CallTrace[] => {
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

  const results: CallTrace[] = [];
  if (match) {
    results.push(trace);
  }

  if (!trace.error) {
    for (const call of trace.calls ?? []) {
      results.push(...searchForCalls(call, options));
    }
  }

  return results;
};

// Internal methods

const normalizeTrace = (trace: CallTrace) => {
  // Lowercase the `type`
  trace.type = trace.type.toLowerCase() as CallType;

  // Normalize `revertReason` to `error`
  if (trace.revertReason && !trace.error) {
    trace.error = trace.revertReason;
  }

  for (const call of trace.calls ?? []) {
    normalizeTrace(call);
  }
  return trace;
};

export const isPrecompile = (address: string | null) => {
  // Covers zkSync precompiles which have the format `0x0000000000000000000000000000000000008XXX`
  if (address && address.startsWith("0x000000000000000000000000000000000000")) {
    return true;
  }

  return false;
};

const internalParseCallTrace = (
  state: StateChange,
  payments: Payment[],
  trace: CallTrace,
  skipHandler?: boolean
) => {
  if (!trace.error) {
    if (trace.type === "call" && !skipHandler) {
      const handlers = getHandlers(trace);
      for (const { handle } of handlers) {
        handle(state, payments, trace);
      }
    }

    if (trace.type === "call" || trace.type === "delegatecall") {
      for (const call of trace.calls ?? []) {
        // We have this check to avoid weird trace results from zkSync-based chains
        // where a call can be duplicated within its own internal calls
        const skipHandler =
          !isPrecompile(trace.from) &&
          !isPrecompile(trace.to) &&
          !isPrecompile(call.from) &&
          !isPrecompile(call.to)
            ? call.from === trace.from && call.to === trace.to
            : false;

        internalParseCallTrace(state, payments, call, skipHandler);
      }
    }
  }
};

const internalMapToGethTraceFormat = (
  traces: CallTraceOpenEthereum[]
): CallTrace => {
  const initCallTrace = (trace: CallTraceOpenEthereum): CallTrace => ({
    type: trace.action.callType.toLowerCase() as CallType,
    from: trace.action.from,
    to: trace.action.to,
    input: trace.action.input,
    output: trace.result.output || "0x",
    value: trace.action.value,
    gas: trace.action.gas,
    gasUsed: trace.result.gasUsed || "0x",
    error: trace.error,
    calls: [],
  });

  const callTrace = initCallTrace(traces[0]);
  for (const trace of traces.slice(1)) {
    let relevantCallTrace = callTrace;
    for (let i = 0; i < trace.traceAddress.length - 1; i++) {
      relevantCallTrace = relevantCallTrace.calls![trace.traceAddress[i]];
    }
    relevantCallTrace.calls!.push(initCallTrace(trace));
  }

  return callTrace;
};
