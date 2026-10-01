import { Interface } from "@ethersproject/abi";
import { AddressZero } from "@ethersproject/constants";

import { getStateChange } from "../../src";
import type { CallTrace, Log } from "../../src/types";

const sender = "0x1111111111111111111111111111111111111111";
const recipient = "0x2222222222222222222222222222222222222222";
const token = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const implementation = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const erc20 = `erc20:${token}`;
const native = `native:${AddressZero}`;
const iface = new Interface([
  "function transfer(address to, uint256 value)",
  "function transferFrom(address from, address to, uint256 value)",
  "function mint(address to, uint256 value)",
  "function burn(uint256 value)",
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes signature)",
  "function deposit()",
  "function deposit(address to)",
  "function depositTo(address to)",
  "function withdraw(uint256 value)",
  "function withdrawTo(address to, uint256 value)",
  "function withdrawFrom(address from, address to, uint256 value)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Deposit(address indexed dst, uint256 wad)",
  "event Withdrawal(address indexed src, uint256 wad)",
]);
const nftIface = new Interface([
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]);
const trace = (overrides: Partial<CallTrace> = {}): CallTrace => ({
  type: "call", from: sender, to: token, input: "0x", output: "0x",
  gas: "0x100000", gasUsed: "0x100", ...overrides,
});
const event = (name: string, args: unknown[], address = token): Log => ({
  address, ...iface.encodeEventLog(iface.getEvent(name), args),
});
const transfer = (from = sender, to = recipient, amount = "10") =>
  event("Transfer", [from, to, amount]);
const transferred = (amount = "10", currency = erc20) => ({
  [sender]: { tokenBalanceState: { [currency]: `-${amount}` } },
  [recipient]: { tokenBalanceState: { [currency]: amount } },
});

describe("ERC20 event transfers", () => {
  it("uses emitted amounts and fees instead of calldata", () => {
    const call = trace({
      input: iface.encodeFunctionData("transfer", [recipient, 100]),
      logs: [transfer(sender, recipient, "90"), transfer(sender, implementation, "10")],
    });
    expect(getStateChange(call)).toEqual({
      [sender]: { tokenBalanceState: { [erc20]: "-100" } },
      [recipient]: { tokenBalanceState: { [erc20]: "90" } },
      [implementation]: { tokenBalanceState: { [erc20]: "10" } },
    });
  });

  it("detects transfers from arbitrary methods, using the emitter address", () => {
    const call = trace({ to: implementation, input: "0x12345678", logs: [transfer()] });
    expect(getStateChange(call)).toEqual(transferred());
  });

  it.each([
    ["transfer", [recipient, 10]],
    ["transferFrom", [sender, recipient, 10]],
    ["mint", [recipient, 10]],
    ["burn", [10]],
    ["transferWithAuthorization", [sender, recipient, 10, 0, 100, "0x" + "00".repeat(32), "0x"]],
    ["deposit()", []],
    ["deposit(address)", [recipient]],
    ["depositTo", [recipient]],
    ["withdraw", [10]],
    ["withdrawTo", [recipient, 10]],
    ["withdrawFrom", [sender, recipient, 10]],
  ])("does not infer ERC20 movements from %s calldata without events", (method, args) => {
    const call = trace({
      input: iface.encodeFunctionData(method as string, args as unknown[]),
      output: "0x" + "00".repeat(32),
      value: "0xa",
    });
    expect(getStateChange(call)).toEqual({
      [sender]: { tokenBalanceState: { [native]: "-10" } },
      [token]: { tokenBalanceState: { [native]: "10" } },
    });
  });

  it("handles minting, burning, zero amounts and self transfers", () => {
    const call = trace({ logs: [
      transfer(AddressZero, sender, "20"), transfer(sender, AddressZero, "5"),
      transfer(sender, sender, "3"), transfer(sender, recipient, "0"),
    ] });
    expect(getStateChange(call)).toEqual({
      [AddressZero]: { tokenBalanceState: { [erc20]: "-15" } },
      [sender]: { tokenBalanceState: { [erc20]: "15" } },
    });
  });

  it("reads delegatecall logs once without treating no-return ERC20s as NFTs", () => {
    const input = iface.encodeFunctionData("transferFrom", [sender, recipient, 10]);
    const call = trace({ input, calls: [trace({
      type: "delegatecall", to: implementation, input, logs: [transfer()],
    })] });
    expect(getStateChange(call)).toEqual(transferred());
  });

  it.each([token, "0xdac17f958d2ee523a2206206994597c13d831ec7"])(
    "does not infer any transfer from no-return transferFrom calldata at %s",
    (address) => {
      const call = trace({
        to: address,
        input: iface.encodeFunctionData("transferFrom", [sender, recipient, 10]),
      });
      expect(getStateChange(call)).toEqual({});
    }
  );

  it("does not skip events in nested calls with the same sender and recipient", () => {
    expect(getStateChange(trace({ calls: [trace({ logs: [transfer(), transfer()] })] })))
      .toEqual(transferred("20"));
  });

  it.each(["error", "revertReason"])("excludes reverted subtrees marked by %s", (field) => {
    const failed = trace({ [field]: "reverted", logs: [transfer()], calls: [trace({ logs: [transfer()] })] });
    expect(getStateChange(failed)).toEqual({});
    expect(getStateChange(trace({ calls: [failed, trace({ logs: [transfer()] })] })))
      .toEqual(transferred());
  });

  it("ignores NFT, unrelated and malformed logs while retaining valid events", () => {
    const nftLog = { address: token, ...nftIface.encodeEventLog(nftIface.getEvent("Transfer"), [sender, recipient, 10]) };
    expect(getStateChange(trace({ logs: [
      nftLog, { ...transfer(), data: "0x01" }, { ...transfer(), topics: [] },
      { ...transfer(), topics: [transfer().topics[0], "0x" + "ff".repeat(32), transfer().topics[2]] },
      transfer(),
    ] }))).toEqual(transferred());
  });

  it("keeps ERC721 transferFrom handling", () => {
    const call = trace({
      input: iface.encodeFunctionData("transferFrom", [sender, recipient, 10]),
      logs: [{ address: token, ...nftIface.encodeEventLog(nftIface.getEvent("Transfer"), [sender, recipient, 10]) }],
    });
    expect(getStateChange(call)).toEqual(transferred("1", `erc721:${token}:10`));
  });

  it("confirms ERC721 transfers using proxy events instead of return data", () => {
    const input = iface.encodeFunctionData("transferFrom", [sender, recipient, 10]);
    const call = trace({
      input,
      output: "0x" + "00".repeat(32),
      calls: [trace({
        type: "delegatecall",
        to: implementation,
        logs: [{ address: token, ...nftIface.encodeEventLog(nftIface.getEvent("Transfer"), [sender, recipient, 10]) }],
      })],
    });
    expect(getStateChange(call)).toEqual(transferred("1", `erc721:${token}:10`));
  });

  it("normalizes event addresses", () => {
    expect(getStateChange(trace({ logs: [{ ...transfer(), address: "0x" + token.slice(2).toUpperCase() }] })))
      .toEqual(transferred());
  });
});

describe("supplied logs", () => {
  it("uses receipt logs when the trace has no logs", () => {
    expect(getStateChange(trace(), [transfer()])).toEqual(transferred());
  });

  it("replaces embedded logs across the entire call tree without mutating it", () => {
    const call = trace({ logs: [transfer()], calls: [trace({ logs: [transfer()] })] });
    const before = JSON.stringify(call);
    expect(getStateChange(call, [transfer()])).toEqual(transferred());
    expect(JSON.stringify(call)).toBe(before);
  });

  it("treats an empty supplied array as authoritative while keeping native balances", () => {
    const call = trace({ value: "0xa", logs: [transfer()], calls: [trace({ logs: [transfer()] })] });
    expect(getStateChange(call, [])).toEqual({
      [sender]: { tokenBalanceState: { [native]: "-10" } },
      [token]: { tokenBalanceState: { [native]: "10" } },
    });
  });

  it.each(["error", "revertReason"])("ignores supplied logs when the transaction has %s", (field) => {
    expect(getStateChange(trace({ [field]: "reverted" }), [transfer()])).toEqual({});
  });

  it("uses supplied NFT events to recognize nested transferFrom calls", () => {
    const call = trace({ to: implementation, calls: [trace({
      input: iface.encodeFunctionData("transferFrom", [sender, recipient, 10]),
    })] });
    const logs = [{ address: token, ...nftIface.encodeEventLog(nftIface.getEvent("Transfer"), [sender, recipient, 10]) }];
    expect(getStateChange(call, logs)).toEqual(transferred("1", `erc721:${token}:10`));
  });

  it("does not use embedded NFT events when supplied logs are empty", () => {
    const call = trace({
      input: iface.encodeFunctionData("transferFrom", [sender, recipient, 10]),
      calls: [trace({ type: "delegatecall", to: implementation, logs: [
        { address: token, ...nftIface.encodeEventLog(nftIface.getEvent("Transfer"), [sender, recipient, 10]) },
      ] })],
    });
    expect(getStateChange(call, [])).toEqual({});
  });

  it("preserves wrapping and avoids counting a matching Transfer twice", () => {
    const logs = [event("Deposit", [sender, 20]), transfer(AddressZero, sender, "20")];
    expect(getStateChange(trace(), logs)).toEqual(getStateChange(trace({ logs })));
  });
});

describe("wrapped and native tokens", () => {
  it.each([false, true])("does not count zkSync native ETH events as ERC20 balances (supplied logs: %s)", (supplied) => {
    const logs = [event("Transfer", [sender, recipient, 10], "0x000000000000000000000000000000000000800a")];
    const call = trace({ to: recipient, value: "0xa", ...(supplied ? {} : { logs }) });
    expect(getStateChange(call, supplied ? logs : undefined)).toEqual({
      [sender]: { tokenBalanceState: { [native]: "-10" } },
      [recipient]: { tokenBalanceState: { [native]: "10" } },
    });
  });

  it("uses Deposit and Withdrawal events for wrapped balances", () => {
    const call = trace({ logs: [event("Deposit", [sender, 20]), event("Withdrawal", [sender, 5])] });
    expect(getStateChange(call)).toEqual({ [sender]: { tokenBalanceState: { [erc20]: "15" } } });
  });

  it("does not count wrapping twice when Transfer is also emitted", () => {
    const call = trace({ logs: [
      event("Deposit", [sender, 20]), transfer(AddressZero, sender, "20"),
      transfer(sender, AddressZero, "5"), event("Withdrawal", [sender, 5]),
    ] });
    expect(getStateChange(call)).toEqual({
      [AddressZero]: { tokenBalanceState: { [erc20]: "-15" } },
      [sender]: { tokenBalanceState: { [erc20]: "15" } },
    });
  });

  it("preserves native value handling alongside wrapped token events", () => {
    const call = trace({ value: "0xa", input: iface.encodeFunctionData("deposit()"), logs: [event("Deposit", [sender, 10])] });
    expect(getStateChange(call)).toEqual({
      [sender]: { tokenBalanceState: { [native]: "-10", [erc20]: "10" } },
      [token]: { tokenBalanceState: { [native]: "10" } },
    });
  });

  it("preserves zkSync native refunds parsed from calldata", () => {
    const nativeIface = new Interface(["function transfer(address token,address to,uint256 amount)"]);
    const system = "0x000000000000000000000000000000000000800a";
    const call = trace({ to: system, input: nativeIface.encodeFunctionData("transfer", [AddressZero, recipient, 10]) });
    expect(getStateChange(call)).toEqual({ [recipient]: { tokenBalanceState: { [native]: "10" } } });
  });
});
