import type { JsonRpcProvider } from "@ethersproject/providers";
import axios from "axios";

import { getBlockTraces, getCallTrace, getStateChange, getTxTraces } from "../../src";
import type { Call, CallTrace } from "../../src/types";

jest.mock("axios");

const call: Call = {
  from: "0x1111111111111111111111111111111111111111",
  to: "0x2222222222222222222222222222222222222222",
  data: "0x",
  value: 10,
  maxFeePerGas: 0,
  maxPriorityFeePerGas: 0,
};
const trace = (): CallTrace => ({
  type: "call", from: call.from, to: call.to, input: call.data,
  output: "0x", gas: "0x10000", gasUsed: "0x100", value: "0xa",
});
const nativeChanges = {
  [call.from]: { tokenBalanceState: { "native:0x0000000000000000000000000000000000000000": "-10" } },
  [call.to]: { tokenBalanceState: { "native:0x0000000000000000000000000000000000000000": "10" } },
};

describe.each(["call", "block", "transaction", "batch"] as const)("%s trace log collection", (method) => {
  const provider = {
    connection: { url: "http://localhost:8545" },
    send: jest.fn(),
  } as unknown as JsonRpcProvider;

  afterEach(() => jest.resetAllMocks());

  it.each([undefined, false, true])("only requests logs when includeLogs is true (received %s)", async (includeLogs) => {
    const options = includeLogs === undefined ? undefined : { includeLogs };
    const post = jest.mocked(axios.post);
    let traces: CallTrace[];
    let configs: { tracer: string; tracerConfig?: { withLog: boolean } }[];

    if (method === "call") {
      const send = jest.spyOn(provider, "send").mockResolvedValue(trace());
      traces = [await getCallTrace(call, provider, options)];
      configs = [send.mock.calls[0][1][2]];
    } else {
      if (method === "block") {
        post.mockResolvedValueOnce({ data: { result: [{ txHash: "0x1", result: trace() }] } });
        traces = Object.values(await getBlockTraces(1, provider, options));
      } else if (method === "transaction") {
        post.mockResolvedValueOnce({ data: { result: trace() } });
        traces = Object.values(await getTxTraces([{ hash: "0x1" }], provider, options));
      } else {
        post.mockResolvedValueOnce({ data: [
          { id: 1, result: trace() }, { id: 0, result: trace() },
        ] });
        const result = await getTxTraces([{ hash: "0x1" }, { hash: "0x2" }], provider, options);
        expect(Object.keys(result).sort()).toEqual(["0x1", "0x2"]);
        traces = Object.values(result);
      }
      const body = JSON.parse(JSON.stringify(post.mock.calls[0][1]));
      configs = (Array.isArray(body) ? body : [body]).map((request) => request.params[1]);
    }

    expect(configs).toHaveLength(method === "batch" ? 2 : 1);
    for (const config of configs) {
      expect(config.tracer).toBe("callTracer");
      expect(config.tracerConfig).toEqual(includeLogs === true ? { withLog: true } : undefined);
    }
    for (const result of traces) {
      expect(result.logsIncluded).toBe(includeLogs === true);
      if (includeLogs === true) {
        // Providers omit `logs` for event-free transactions, even with withLog.
        expect(result.logs).toBeUndefined();
        expect(getStateChange(result)).toEqual(nativeChanges);
        expect(getStateChange(JSON.parse(JSON.stringify(result)))).toEqual(nativeChanges);
      } else {
        expect(() => getStateChange(result)).toThrow("getStateChange requires logs");
      }
      expect(getStateChange(result, [])).toEqual(nativeChanges);
    }
  });
});
