import { AddressZero } from "@ethersproject/constants";

const {
  assertCompleteLogs, diffStates, normalizeTrace, validateSamples,
} = require("../../scripts/compare-state-changes.cjs");

const address = "0x1111111111111111111111111111111111111111";
const token = `erc20:${address}`;
const txHash = "0x" + "ab".repeat(32);
const log = { address, topics: ["0x" + "cd".repeat(32)], data: "0x" };
const state = (amount: string) => ({ [address]: { tokenBalanceState: { [token]: amount } } });

describe("state change comparison", () => {
  it("compares large signed amounts without floating point rounding", () => {
    expect(diffStates(state("-9007199254740993000"), state("-9007199254740993001")))
      .toEqual([{ address, token, old: "-9007199254740993000", new: "-9007199254740993001", delta: "-1" }]);
  });

  it("includes added and removed balances and treats missing entries as zero", () => {
    expect(diffStates(state("10"), {})).toEqual([{ address, token, old: "10", new: "0", delta: "-10" }]);
    expect(diffStates({}, state("10"))).toEqual([{ address, token, old: "0", new: "10", delta: "10" }]);
    expect(diffStates({}, state("0"))).toEqual([]);
  });

  it("does not depend on address or token insertion order", () => {
    const first = { ...state("10"), [AddressZero]: { tokenBalanceState: { [token]: "-10" } } };
    const second = { [AddressZero]: first[AddressZero], ...state("10") };
    expect(diffStates(first, second)).toEqual([]);
  });

  it("rejects traces whose provider silently omitted logs", () => {
    expect(() => assertCompleteLogs({ type: "call" }, { logs: [log] })).toThrow("Trace logs differ");
  });

  it("checks duplicate logs rather than just distinct event signatures", () => {
    expect(() => assertCompleteLogs({ logs: [log] }, { logs: [log, log] })).toThrow("Trace logs differ");
  });

  it("accepts nested logs and ignores reverted branches", () => {
    const trace = normalizeTrace({
      type: "CALL", calls: [
        { type: "DELEGATECALL", logs: [log] },
        { type: "CALL", revertReason: "failed", logs: [log], calls: [{ type: "CALL", logs: [log] }] },
      ],
    });
    expect(trace.calls[0].type).toBe("delegatecall");
    expect(trace.calls[1].error).toBe("failed");
    expect(() => assertCompleteLogs(trace, { logs: [log] })).not.toThrow();
  });

  it("deduplicates transactions while keeping every related Relay request", () => {
    const samples = validateSamples([
      { requestId: "request-a", chainId: 1, txHash },
      { requestId: "request-b", chainId: 1, txHash },
      { requestId: "request-a", chainId: 1, txHash },
      { requestId: "request-a", chainId: 8453, txHash },
    ]);
    expect(samples).toEqual([
      { chainId: 1, txHash, requestIds: ["request-a", "request-b"] },
      { chainId: 8453, txHash, requestIds: ["request-a"] },
    ]);
  });

  it("rejects missing chain IDs instead of guessing a chain", () => {
    expect(() => validateSamples([{ requestId: "request-a", txHash }])).toThrow("chainId");
    expect(() => validateSamples([])).toThrow("nonempty");
  });
});
