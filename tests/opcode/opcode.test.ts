import { describe, it, expect } from "@jest/globals";

import { parseLogsFromTrace } from "../../src/opcode";

import MultiTraceResponse from "./__fixtures__/multi-lite.json";
import MultiTraceResponse2 from "./__fixtures__/multicall-2-lite.json";
import SingleTraceResponse from "./__fixtures__/single-lite.json";

describe("Opcode tracer", () => {
  it("single-call", async () => {
    const eventLogs = parseLogsFromTrace(
      "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      SingleTraceResponse.result
    );

    const Transfer = eventLogs.find(
      (c) =>
        c.topics.includes(
          "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
        ) && c.address === "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
    );
    expect(Transfer).not.toBe(undefined);
  });

  it("multicall", async () => {
    const eventLogs = parseLogsFromTrace(
      "0xc2c862322e9c97d6244a3506655da95f05246fd8",
      MultiTraceResponse.result
    );

    const Approval = eventLogs.find(
      (c) =>
        c.topics.includes(
          "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925"
        ) && c.address === "0x4bb08998a697d0db666783ba5b56e85b33ba262f"
    );
    const Transfer = eventLogs.find(
      (c) =>
        c.topics.includes(
          "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
        ) && c.address === "0x4bb08998a697d0db666783ba5b56e85b33ba262f"
    );
    const OrderFulfilled = eventLogs.find(
      (c) =>
        c.topics.includes(
          "0x9d9af8e38d66c62e2c12f0225249fd9d721c54b83f48d9352c97c6cacdcb6f31"
        ) && c.address === "0x00000000000000adc04c56bf30ac9d3c0aaf14dc"
    );

    expect(Approval).not.toBe(undefined);
    expect(Transfer).not.toBe(undefined);
    expect(OrderFulfilled).not.toBe(undefined);
  });

  // Origin tx hash: 0x201fd5e4ae0471552bd8a15eecc821766021f5b116e80cd1b1fd377ad82c365a
  it("multicall", async () => {
    const eventLogs = parseLogsFromTrace(
      "0x881d40237659c251811cec9c364ef91dc08d300c",
      MultiTraceResponse2.result
    );

    const Swap = eventLogs.find(
      (c) =>
        c.topics.includes(
          "0xbeee1e6e7fe307ddcf84b0a16137a4430ad5e2480fc4f4a8e250ab56ccd7630d"
        ) && c.address === "0x881d40237659c251811cec9c364ef91dc08d300c"
    );

    const RfqOrderFilled = eventLogs.find(
      (c) =>
        c.topics.includes(
          "0x829fa99d94dc4636925b38632e625736a614c154d55006b7ab6bea979c210c32"
        ) && c.address === "0xdef1c0ded9bec7f1a1670819833240f027b25eff"
    );

    expect(Swap).not.toBe(undefined);
    expect(RfqOrderFilled).not.toBe(undefined);
  });
});
