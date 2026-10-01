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

You'll need an RPC endpoint that supports `callTracer` with `withLog`. Logs are
requested by default. You can disable them with `getCallTrace`'s
`{ includeLogs: false }` option, but ERC20 balance changes require logs.

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

To compare balance changes with solver's installed SDK, use
`scripts/compare-state-changes.cjs`. Put request IDs, chain IDs, and transaction
hashes from solver logs in `.local/relay-requests.json`:

```json
[
  { "requestId": "<request-id>", "chainId": 1, "txHash": "<transaction-hash>" }
]
```

Add tracing RPC URLs to `.local/rpcs.json`, keyed by chain ID, or set
`RPC_URL_<chainId>` environment variables. Each RPC must support
`debug_traceTransaction` with logs. The script checks those logs against the
transaction receipt before comparing balances.

```sh
npm run build
node scripts/compare-state-changes.cjs
# Reuse the saved traces without making RPC requests:
node scripts/compare-state-changes.cjs --offline
```

The report in `.local/state-change-comparison/report.json` includes Relay links,
both SDK responses, and differences for each address and token. The baseline is
the SDK installed in `../solver/packages/cross-chain-solver`; use `--old-sdk` to
choose another package directory. Run with `--help` for all options.
`.local/` is git-ignored so request samples, RPC credentials, and reports stay local.
