import type { JsonRpcProvider } from "@ethersproject/providers";
import axios from "axios";

import { getBlockTraces, getCallTrace, getTxTraces } from "../../src";
import type { Call, CallTrace } from "../../src/types";

jest.mock("axios");

const call: Call = {
  from: "0x1111111111111111111111111111111111111111",
  to: "0x2222222222222222222222222222222222222222",
  data: "0x",
  value: 0,
  maxFeePerGas: 0,
  maxPriorityFeePerGas: 0,
};
const trace = (): CallTrace => ({
  type: "call", from: call.from, to: call.to, input: call.data,
  output: "0x", gas: "0x10000", gasUsed: "0x100", logs: [],
});

describe("trace log collection", () => {
  const provider = {
    connection: { url: "http://localhost:8545" },
    send: jest.fn(),
  } as unknown as JsonRpcProvider;

  afterEach(() => jest.restoreAllMocks());

  it("requests logs by default for simulated calls and allows opting out", async () => {
    const send = jest.spyOn(provider, "send").mockResolvedValue(trace());
    await getCallTrace(call, provider);
    expect(send.mock.calls[0][1][2].tracerConfig).toEqual({ withLog: true });

    await getCallTrace(call, provider, { includeLogs: false });
    expect(send.mock.calls[1][1][2].tracerConfig).toBeUndefined();
  });

  it("requests logs for block traces", async () => {
    const post = jest.mocked(axios.post);
    post.mockResolvedValueOnce({ data: { result: [{ txHash: "0x1", result: trace() }] } });
    const result = await getBlockTraces(1, provider);
    expect(post.mock.calls[0][1]).toEqual(expect.objectContaining({
      params: ["0x1", { tracer: "callTracer", tracerConfig: { withLog: true } }],
    }));
    expect(result["0x1"].logs).toEqual([]);
  });

  it("requests logs for a single transaction", async () => {
    const post = jest.mocked(axios.post);
    post.mockResolvedValueOnce({ data: { result: trace() } });
    await getTxTraces([{ hash: "0x1" }], provider);
    expect(post.mock.calls[0][1]).toEqual(expect.objectContaining({
      params: ["0x1", { tracer: "callTracer", tracerConfig: { withLog: true } }],
    }));
  });

  it("requests logs for every transaction in a batch", async () => {
    const post = jest.mocked(axios.post);
    post.mockResolvedValueOnce({ data: [
      { id: 1, result: trace() }, { id: 0, result: trace() },
    ] });
    const result = await getTxTraces([{ hash: "0x1" }, { hash: "0x2" }], provider);
    expect(post.mock.calls[0][1]).toEqual([
      expect.objectContaining({ params: ["0x1", { tracer: "callTracer", tracerConfig: { withLog: true } }] }),
      expect.objectContaining({ params: ["0x2", { tracer: "callTracer", tracerConfig: { withLog: true } }] }),
    ]);
    expect(Object.keys(result).sort()).toEqual(["0x1", "0x2"]);
  });

  it("omits tracerConfig when block logs are disabled", async () => {
    const post = jest.mocked(axios.post);
    post.mockResolvedValueOnce({ data: { result: [{ txHash: "0x1", result: trace() }] } });
    await getBlockTraces(1, provider, { includeLogs: false });
    const body = JSON.parse(JSON.stringify(post.mock.calls[0][1]));
    expect(body.params[1]).toEqual({ tracer: "callTracer" });
  });

  it("omits tracerConfig for a single transaction when logs are disabled", async () => {
    const post = jest.mocked(axios.post);
    post.mockResolvedValueOnce({ data: { result: trace() } });
    await getTxTraces([{ hash: "0x1" }], provider, { includeLogs: false });
    const body = JSON.parse(JSON.stringify(post.mock.calls[0][1]));
    expect(body.params[1]).toEqual({ tracer: "callTracer" });
  });

  it("omits tracerConfig for all transactions in a batch when logs are disabled", async () => {
    const post = jest.mocked(axios.post);
    post.mockResolvedValueOnce({ data: [
      { id: 0, result: trace() }, { id: 1, result: trace() },
    ] });
    await getTxTraces([{ hash: "0x1" }, { hash: "0x2" }], provider, { includeLogs: false });
    const body = JSON.parse(JSON.stringify(post.mock.calls[0][1]));
    expect(body.map((request: { params: unknown[] }) => request.params[1])).toEqual([
      { tracer: "callTracer" }, { tracer: "callTracer" },
    ]);
  });
});
