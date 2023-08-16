import { BigNumber } from "ethers";
import { arrayify, hexStripZeros, hexZeroPad, hexlify } from "ethers/lib/utils";
import { Log } from "./types";

export interface LoggerTrace {
  gas: number;
  returnValue: any;
  structLogs: StructLog[];
}

export interface StructLog {
  depth: number;
  error?: string;
  gas: number;
  gasCost: number;
  memory?: null | string[];
  op: string;
  pc: number;
  stack: string[];
}

export interface ScopeContext {
  op: string;
  contract: string;
  depth: number;
}

export function parseAddress(str: string) {
  return hexZeroPad(hexStripZeros(hexPrefix(str)), 20);
}

export function hexPrefix(str: string) {
  return !str.startsWith("0x") ? "0x" + str : str;
}

export function parseUint(str: string) {
  return BigNumber.from(hexPrefix(str));
}

export function parseBytes32(str: string) {
  return hexZeroPad(hexStripZeros(hexPrefix(str)), 32);
}

export function parseMemory(strArr: string[]) {
  return arrayify(hexPrefix(strArr.join("")));
}

export function parseLogsFromTrace(to: string, trace: LoggerTrace) {
  const topScopeContext = {
    op: "CALL",
    contract: to.toLowerCase(),
    depth: 0,
  };
  const scopeContexts: ScopeContext[] = [topScopeContext];
  const logs: Log[] = [];

  const { structLogs } = trace;

  for (let index = 0; index < structLogs.length; index++) {
    const step = structLogs[index];
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

    if (!op.startsWith("LOG")) continue;

    // Find parent CALL context
    let closestContext: ScopeContext | null = null;
    for (let i = scopeContexts.length - 1; i >= 0; i--) {
      const context = scopeContexts[i];
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

    // Pase LOG
    const topicSize = parseInt(step.op.slice(3));
    const mStart = parseUint(stackData[stackSize - 1]).toNumber();
    const mSize = parseUint(stackData[stackSize - 2]).toNumber();
    const topics: string[] = [];
    for (let index = 0; index < topicSize; index++) {
      const topic = parseBytes32(stackData[stackSize - 2 - (index + 1)]);
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
}