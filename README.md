# `evm-tx-simulator`

See how an EVM transaction changes ETH and token balances before sending it, or
inspect the balance changes from an existing transaction. Supports native tokens,
ERC20, ERC721, and ERC1155.

There are four methods:

- `getCallTrace` — simulate a transaction without submitting it.
- `getTxTraces` — fetch traces for existing transactions.
- `getBlockTraces` — fetch traces for every transaction in a block.
- `getStateChange` — turn a trace into balance changes for each address.

ERC20 transfers are read from events, including WETH-style deposits and
withdrawals. Native transfers use call values and calldata; NFT transfers use
calldata. Reverted calls don't count toward balance changes.

Logs are requested by default, which requires an RPC endpoint that supports
`callTracer` with `withLog`. If you already have the transaction's receipt logs,
pass them to `getStateChange` and disable log collection when fetching the trace:

```ts
const traces = await getTxTraces([{ hash }], provider, { includeLogs: false });
const changes = getStateChange(traces[hash], receipt.logs);
```

`getCallTrace` and `getBlockTraces` also accept `{ includeLogs: false }`. Supplied
logs replace all logs embedded in the trace, including when you pass an empty
array. Use the committed logs for that transaction; without supplied logs,
`getStateChange` reads them from the trace.

TypeScript types, including `Call` and `CallTrace`, can be imported from
`@georgeroman/evm-tx-simulator/dist/types`.

Here's an example of `getStateChange` output. Positive amounts are balance
increases; negative amounts are decreases. Amounts use the token's smallest unit.

```json
{
  "0x0cccd55a5ac261ea29136831eeaa93bfe07f5db6": {
    "tokenBalanceState": {
      "native:0x0000000000000000000000000000000000000000": "-990000000000000",
      "erc721:0x57f1887a8bf19b14fc0df6fd9b2acc9af147ea85:10530676464258429157976288980766951099646391566276924398001212535050412393470": "1"
    }
  },
  "0x845bd54015813fda33f11e1f261ebc360983e584": {
    "tokenBalanceState": {
      "native:0x0000000000000000000000000000000000000000": "965250000000000",
      "erc721:0x57f1887a8bf19b14fc0df6fd9b2acc9af147ea85:10530676464258429157976288980766951099646391566276924398001212535050412393470": "-1"
    }
  },
  "0x8de9c5a032463c561423387a9648c5c7bcc5bc90": {
    "tokenBalanceState": {
      "native:0x0000000000000000000000000000000000000000": "24750000000000"
    }
  }
}
```
