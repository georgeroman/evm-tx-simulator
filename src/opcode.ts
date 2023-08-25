import {
  arrayify,
  hexStripZeros,
  hexZeroPad,
  hexlify,
} from "@ethersproject/bytes";

import { Log } from "./types";
import { bn } from "./utils";

interface LoggerTrace {
  gas: number;
  returnValue: any;
  structLogs: StructLog[];
}

interface StructLog {
  depth: number;
  error?: string;
  gas: number;
  gasCost: number;
  memory?: null | string[];
  op: string;
  pc: number;
  stack: string[];
}

interface ScopeContext {
  op: string;
  contract: string;
  depth: number;
}

const parseAddress = (s: string) => hexZeroPad(hexStripZeros(hexPrefix(s)), 20);

const hexPrefix = (s: string) => (!s.startsWith("0x") ? "0x" + s : s);

const parseUint = (s: string) => bn(hexPrefix(s));

const parseBytes32 = (s: string) => hexZeroPad(hexStripZeros(hexPrefix(s)), 32);

const parseMemory = (sArray: string[]) => arrayify(hexPrefix(sArray.join("")));

export const parseLogsFromTrace = (to: string, trace: LoggerTrace) => {
  const topScopeContext = {
    op: "CALL",
    contract: to.toLowerCase(),
    depth: 0,
  };
  const scopeContexts: ScopeContext[] = [topScopeContext];
  const logs: Log[] = [];

  const { structLogs } = trace;

  for (let i = 0; i < structLogs.length; i++) {
    const step = structLogs[i];
    const { stack: stackData, op, depth } = step;

    const stackSize = stackData.length;
    if (["CALL", "STATICCALL", "DELEGATECALL"].includes(op)) {
      const to = parseAddress(stackData[stackSize - 2]);
      scopeContexts.push({
        op,
        contract: to,
        depth,
      });
    }

    if (!op.startsWith("LOG")) {
      continue;
    }

    // Find parent CALL context
    let closestContext: ScopeContext | null = null;
    for (let j = scopeContexts.length - 1; j >= 0; j--) {
      const context = scopeContexts[j];
      for (let parentDepth = depth - 1; parentDepth >= 0; parentDepth--) {
        if (context.depth === parentDepth && context.op === "CALL") {
          closestContext = context;
          break;
        }
      }

      if (closestContext) {
        break;
      }
    }

    // Parse LOG opcodes
    const topicSize = parseInt(step.op.slice(3));
    const mStart = parseUint(stackData[stackSize - 1]).toNumber();
    const mSize = parseUint(stackData[stackSize - 2]).toNumber();

    const topics: string[] = [];
    for (let j = 0; j < topicSize; j++) {
      const topic = parseBytes32(stackData[stackSize - 2 - (j + 1)]);
      topics.push(topic);
    }

    let data = "0x";
    if (step.memory) {
      const memory = parseMemory(step.memory);
      data = hexlify(memory.slice(mStart, mStart + mSize));
    }

    const currentAddress = (closestContext ?? topScopeContext).contract;
    logs.push({
      address: currentAddress,
      topics,
      data,
    });
  }

  return logs;
};
