import { BlockTag, JsonRpcProvider } from "@ethersproject/providers";
import axios from "axios";

import { getHandlers } from "./handlers";
import { handleERC20Logs } from "./handlers/transfers/events";
import { hex, isPrecompile } from "./utils";

import type { Call, CallTrace, CallType, Log, StateChange } from "./types";

export const getCallTrace = async (
  call: Call,
  provider: JsonRpcProvider,
  options?: {
    block?: BlockTag;
    skipReverts?: boolean;
    // Defaults to false. Enable to use getStateChange without supplied logs.
    includeLogs?: boolean;
  }
): Promise<CallTrace> => {
  const trace: CallTrace = await provider.send("debug_traceCall", [
    {
      ...call,
      value: hex(call.value),
      ...(call.gas !== undefined && { gas: hex(call.gas) }),
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
      tracerConfig: options?.includeLogs === true ? { withLog: true } : undefined,
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

  return normalizeTrace(trace, options?.includeLogs);
};

type Tx = {
  hash: string;
};

export const getBlockTraces = async (
  block: number,
  provider: JsonRpcProvider,
  options?: { includeLogs?: boolean }
): Promise<{ [txHash: string]: CallTrace }> => {
  const results = await axios
    .post(
      provider.connection.url,
      {
        method: "debug_traceBlockByNumber",
        params: [
          hex(block),
          {
            tracer: "callTracer",
            tracerConfig: options?.includeLogs === true ? { withLog: true } : undefined,
          },
        ],
        jsonrpc: "2.0",
        id: 1,
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    )
    .then((response) => {
      if (response.data.error) {
        throw new Error(
          `debug_traceBlockByNumber failed: ${
            response.data.error.message ?? JSON.stringify(response.data.error)
          }`
        );
      }
      return response.data.result as { txHash: string; result: CallTrace }[];
    });

  return Object.fromEntries(
    results.map(({ txHash, result }) => [txHash, normalizeTrace(result, options?.includeLogs)])
  );
};

export const getTxTraces = async (
  txs: Tx[],
  provider: JsonRpcProvider,
  options?: { includeLogs?: boolean }
): Promise<{ [txHash: string]: CallTrace }> => {
  if (txs.length === 1) {
    const { result } = await axios
      .post(
        provider.connection.url,
        {
          method: "debug_traceTransaction",
          params: [
            txs[0].hash,
            {
              tracer: "callTracer",
              tracerConfig: options?.includeLogs === true ? { withLog: true } : undefined,
            },
          ],
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
      [txs[0].hash]: normalizeTrace(result, options?.includeLogs),
    };
  } else {
    const results = await axios
      .post(
        provider.connection.url,
        txs.map((tx, i) => ({
          method: "debug_traceTransaction",
          params: [
            tx.hash,
            {
              tracer: "callTracer",
              tracerConfig: options?.includeLogs === true ? { withLog: true } : undefined,
            },
          ],
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
      results.map(({ id, result }) => [txs[id].hash, normalizeTrace(result, options?.includeLogs)])
    );
  }
};

export const getStateChange = (trace: CallTrace, logs?: Log[]): StateChange => {
  if (logs === undefined && trace.logsIncluded !== true) {
    throw new Error(
      "getStateChange requires logs: pass receipt logs (or [] if none), or fetch the trace with includeLogs: true"
    );
  }

  const state: StateChange = {};
  if (trace.error || trace.revertReason) return state;

  internalParseCallTrace(state, trace, false, logs);
  if (logs !== undefined) handleERC20Logs(state, logs);

  return state;
};

// Internal methods

const normalizeTrace = (trace: CallTrace, includeLogs = false) => {
  // An event-free trace can omit `logs` even when withLog was enabled.
  trace.logsIncluded = includeLogs;

  // Lowercase the `type`
  trace.type = trace.type.toLowerCase() as CallType;

  // Normalize `revertReason` to `error`
  if (trace.revertReason && !trace.error) {
    trace.error = trace.revertReason;
  }

  for (const call of trace.calls ?? []) {
    normalizeTrace(call, includeLogs);
  }
  return trace;
};

const internalParseCallTrace = (
  state: StateChange,
  trace: CallTrace,
  skipHandler?: boolean,
  logs?: Log[]
) => {
  if (!trace.error && !trace.revertReason) {
    if (trace.type === "call" && !skipHandler) {
      const handlers = getHandlers(trace);
      for (const { handle } of handlers) {
        try {
          handle(state, trace, logs);
        } catch (error: any) {
          if (error.message?.includes("data out-of-bounds")) {
            // We should skip this error since it's coming from selector overwrite
          } else {
            throw error;
          }
        }
      }
    }

    // Logs belong to their emitting frame, including delegatecalls. The
    // calldata duplicate-call heuristic must not suppress genuine events.
    if (logs === undefined) handleERC20Logs(state, trace.logs ?? []);

    if (trace.type !== "staticcall") {
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

        internalParseCallTrace(state, call, skipHandler, logs);
      }
    }
  }
};
