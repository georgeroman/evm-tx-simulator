import { Interface } from "@ethersproject/abi";
import { AddressZero } from "@ethersproject/constants";

import { bn } from "../../utils";
import type { CallTrace, Log, StateChange } from "../../types";
import { adjustBalance } from "./balances";

type Transfer = {
  from: string;
  to: string;
  token: string;
  amount: string;
};

const iface = new Interface([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Deposit(address indexed dst, uint256 wad)",
  "event Withdrawal(address indexed src, uint256 wad)",
]);

const transferTopic = iface.getEventTopic("Transfer");
const depositTopic = iface.getEventTopic("Deposit");
const withdrawalTopic = iface.getEventTopic("Withdrawal");

const decodeEvent = (log: Log) => {
  const topic = log.topics[0]?.toLowerCase();
  const name =
    topic === transferTopic
      ? "Transfer"
      : topic === depositTopic
      ? "Deposit"
      : topic === withdrawalTopic
      ? "Withdrawal"
      : undefined;

  // ERC721 Transfer events share the signature but have four topics.
  if (
    !name ||
    log.topics.length !== (name === "Transfer" ? 3 : 2) ||
    !/^0x[0-9a-f]{64}$/i.test(log.data) ||
    !log.topics.every((topic) => /^0x[0-9a-f]{64}$/i.test(topic))
  ) {
    return;
  }

  try {
    const args = iface.decodeEventLog(name, log.data, log.topics);
    const transfer: Transfer = {
      from: (
        name === "Deposit" ? AddressZero : name === "Withdrawal" ? args.src : args.from
      ).toLowerCase(),
      to: (
        name === "Withdrawal" ? AddressZero : name === "Deposit" ? args.dst : args.to
      ).toLowerCase(),
      token: `erc20:${log.address.toLowerCase()}`,
      amount: (name === "Transfer" ? args.value : args.wad).toString(),
    };
    return { name, transfer };
  } catch {
    // An unrelated or malformed event must not prevent processing other logs.
    return;
  }
};

export const hasERC721Transfer = (trace: CallTrace, address: string): boolean => {
  if (trace.error || trace.revertReason) return false;

  return (
    (trace.logs ?? []).some(
      (log) =>
        log.address.toLowerCase() === address.toLowerCase() &&
        log.topics[0]?.toLowerCase() === transferTopic &&
        log.topics.length === 4 &&
        log.topics.every((topic) => /^0x[0-9a-f]{64}$/i.test(topic)) &&
        log.data === "0x"
    ) || (trace.calls ?? []).some((call) => hasERC721Transfer(call, address))
  );
};

export const handleERC20Logs = (state: StateChange, logs: Log[]) => {
  const events = logs.map(decodeEvent);
  // Some wrappers emit both Transfer and Deposit/Withdrawal for one movement.
  // Match each Transfer once, without collapsing repeated genuine transfers.
  const transfers = new Map<string, number>();
  const key = (transfer: Transfer) => JSON.stringify(transfer);
  for (const event of events) {
    if (event?.name === "Transfer") {
      const id = key(event.transfer);
      transfers.set(id, (transfers.get(id) ?? 0) + 1);
    }
  }

  for (const event of events) {
    if (!event) continue;
    const { name, transfer } = event;
    if (name !== "Transfer") {
      const id = key(transfer);
      const count = transfers.get(id) ?? 0;
      if (count > 0) {
        transfers.set(id, count - 1);
        continue;
      }
    }

    const { from, to, token, amount } = transfer;
    // Preserve the existing wrapped-token convention: the zero address isn't
    // assigned a balance for Deposit/Withdrawal events.
    if (name !== "Deposit") {
      adjustBalance(state, {
        address: from,
        token,
        adjustment: bn(amount).mul(-1),
      });
    }
    if (name !== "Withdrawal") {
      adjustBalance(state, { address: to, token, adjustment: amount });
    }
  }
};
