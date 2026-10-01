#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const axios = require("axios");

const root = path.resolve(__dirname, "..");
const help = `Compare getStateChange from solver's installed SDK with this checkout.

Build this checkout first: npm run build
Then run: node scripts/compare-state-changes.cjs [options]

  --samples FILE     JSON array of { requestId, chainId, txHash } from solver logs
                     (default: .local/relay-requests.json)
  --rpc-config FILE  JSON object mapping chain IDs to RPC URLs or URL arrays
                     (default: .local/rpcs.json; RPC_URL_<chainId> overrides it)
  --old-sdk DIR      Old SDK package directory
                     (default: ../solver/packages/cross-chain-solver/node_modules/@georgeroman/evm-tx-simulator)
  --output FILE      Full old/new responses and balance diffs
                     (default: .local/state-change-comparison/report.json)
  --cache-dir DIR    Cached traces and receipts for repeatable offline runs
                     (default: .local/state-change-comparison/traces)
  --offline          Use cached traces only; make no RPC requests
  --fail-on-diff     Exit with code 2 when balances differ (errors always exit 1)
  --help             Show this help

No transactions are submitted. Both parsers receive separate copies of the same
trace. Receipt logs are checked against trace logs so missing events cannot look
like a successful comparison. Samples and reports should stay in .local/.
`;

function parseArgs(argv) {
  const options = {
    samples: path.join(root, ".local/relay-requests.json"),
    rpcConfig: path.join(root, ".local/rpcs.json"),
    oldSdk: path.resolve(root, "../solver/packages/cross-chain-solver/node_modules/@georgeroman/evm-tx-simulator"),
    output: path.join(root, ".local/state-change-comparison/report.json"),
    cacheDir: path.join(root, ".local/state-change-comparison/traces"),
    offline: false,
    failOnDiff: false,
  };
  const flags = {
    "--samples": "samples", "--rpc-config": "rpcConfig", "--old-sdk": "oldSdk",
    "--output": "output", "--cache-dir": "cacheDir",
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help") options.help = true;
    else if (arg === "--offline") options.offline = true;
    else if (arg === "--fail-on-diff") options.failOnDiff = true;
    else if (flags[arg] && argv[i + 1] && !argv[i + 1].startsWith("--")) {
      options[flags[arg]] = path.resolve(argv[++i]);
    } else throw new Error(`Unknown option or missing value: ${arg}`);
  }
  return options;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
}

function normalizeTrace(trace) {
  trace.type = trace.type.toLowerCase();
  if (trace.revertReason && !trace.error) trace.error = trace.revertReason;
  for (const call of trace.calls ?? []) normalizeTrace(call);
  return trace;
}

function collectLogs(trace) {
  if (trace.error || trace.revertReason) return [];
  return [...(trace.logs ?? []), ...(trace.calls ?? []).flatMap(collectLogs)];
}

function assertCompleteLogs(trace, receipt) {
  const key = (log) => JSON.stringify([
    log.address.toLowerCase(), log.topics.map((topic) => topic.toLowerCase()),
    log.data.toLowerCase(),
  ]);
  const actual = collectLogs(trace).map(key).sort();
  const expected = receipt.logs.map(key).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Trace logs differ from receipt logs (${actual.length} vs ${expected.length}); check withLog support`);
  }
}

function diffStates(oldState, newState) {
  const differences = [];
  const addresses = [...new Set([...Object.keys(oldState), ...Object.keys(newState)])].sort();
  for (const address of addresses) {
    const oldTokens = oldState[address]?.tokenBalanceState ?? {};
    const newTokens = newState[address]?.tokenBalanceState ?? {};
    const tokens = [...new Set([...Object.keys(oldTokens), ...Object.keys(newTokens)])].sort();
    for (const token of tokens) {
      const oldAmount = BigInt(oldTokens[token] ?? "0");
      const newAmount = BigInt(newTokens[token] ?? "0");
      if (oldAmount !== newAmount) differences.push({
        address, token, old: oldAmount.toString(), new: newAmount.toString(),
        delta: (newAmount - oldAmount).toString(),
      });
    }
  }
  return differences;
}

function validateSamples(input) {
  if (!Array.isArray(input) || input.length === 0) throw new Error("Samples must be a nonempty JSON array");
  const unique = new Map();
  for (const sample of input) {
    if (!Number.isSafeInteger(sample.chainId) || sample.chainId <= 0 ||
        !/^0x[0-9a-f]{64}$/i.test(sample.txHash) ||
        typeof sample.requestId !== "string" || !sample.requestId) {
      throw new Error("Each sample needs requestId, positive integer chainId, and an EVM txHash");
    }
    const txHash = sample.txHash.toLowerCase();
    const key = `${sample.chainId}:${txHash}`;
    if (!unique.has(key)) unique.set(key, { chainId: sample.chainId, txHash, requestIds: [] });
    const entry = unique.get(key);
    if (!entry.requestIds.includes(sample.requestId)) entry.requestIds.push(sample.requestId);
  }
  return [...unique.values()];
}

async function rpc(url, method, params) {
  let data;
  try {
    ({ data } = await axios.post(url, { jsonrpc: "2.0", id: 1, method, params }, { timeout: 60000 }));
  } catch (error) {
    // Axios errors can contain authenticated RPC URLs. Never print them.
    throw new Error(`${method} failed (${error.response?.status ?? error.code ?? "network error"})`);
  }
  if (data.error) throw new Error(`${method} RPC error ${data.error.code}`);
  if (data.result == null) throw new Error(`${method} returned no result`);
  return data.result;
}

async function loadTrace(sample, options, rpcConfig) {
  const file = path.join(options.cacheDir, `${sample.chainId}-${sample.txHash}.json`);
  const validate = (cached) => {
    if (cached.chainId !== sample.chainId || cached.txHash !== sample.txHash ||
        cached.receipt?.transactionHash?.toLowerCase() !== sample.txHash) {
      throw new Error("Cached trace or receipt does not match the requested transaction");
    }
    normalizeTrace(cached.trace);
    assertCompleteLogs(cached.trace, cached.receipt);
    return cached;
  };
  if (fs.existsSync(file)) return validate(readJson(file));
  if (options.offline) throw new Error("No cached trace; run once with an RPC endpoint first");

  const configured = process.env[`RPC_URL_${sample.chainId}`] || rpcConfig[sample.chainId];
  const urls = Array.isArray(configured) ? configured : configured ? [configured] : [];
  if (!urls.length) throw new Error(`No RPC configured for chain ${sample.chainId}`);
  const errors = [];
  for (const url of urls) {
    try {
      const chainId = await rpc(url, "eth_chainId", []);
      if (BigInt(chainId) !== BigInt(sample.chainId)) throw new Error("RPC chain ID does not match sample");
      const trace = await rpc(url, "debug_traceTransaction", [
        sample.txHash, { tracer: "callTracer", tracerConfig: { withLog: true } },
      ]);
      const receipt = await rpc(url, "eth_getTransactionReceipt", [sample.txHash]);
      const cached = validate({ chainId: sample.chainId, txHash: sample.txHash, trace, receipt });
      writeJson(file, cached);
      return cached;
    } catch (error) {
      errors.push(error.message);
    }
  }
  throw new Error(`All ${urls.length} RPC endpoints failed: ${errors.join("; ")}`);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return console.log(help);
  const samples = validateSamples(readJson(options.samples));
  const oldSdk = require(options.oldSdk);
  const newSdk = require(path.join(root, "dist"));
  if (typeof oldSdk.getStateChange !== "function" || typeof newSdk.getStateChange !== "function") {
    throw new Error("Both SDKs must export getStateChange; build this checkout first");
  }
  const oldVersion = readJson(path.join(options.oldSdk, "package.json")).version;
  const rpcConfig = !options.offline && fs.existsSync(options.rpcConfig) ? readJson(options.rpcConfig) : {};
  const report = {
    generatedAt: new Date().toISOString(), oldVersion,
    summary: { compared: 0, identical: 0, different: 0, errors: 0 }, results: [],
  };
  console.log(`Comparing SDK ${oldVersion} with the local build (${samples.length} transactions)`);
  for (const sample of samples) {
    const result = {
      ...sample,
      relayLinks: sample.requestIds.map((id) => `https://relay.link/transaction/${encodeURIComponent(id)}`),
    };
    try {
      const { trace, receipt } = await loadTrace(sample, options, rpcConfig);
      const clone = () => JSON.parse(JSON.stringify(trace));
      result.oldState = oldSdk.getStateChange(clone());
      result.newState = newSdk.getStateChange(clone());
      result.differences = diffStates(result.oldState, result.newState);
      result.logCount = receipt.logs.length;
      result.blockNumber = receipt.blockNumber;
      result.blockHash = receipt.blockHash;
      result.status = result.differences.length ? "different" : "identical";
      report.summary.compared++;
      report.summary[result.status]++;
      console.log(`${result.status.toUpperCase()} chain=${sample.chainId} tx=${sample.txHash} (${result.differences.length} changed balances)`);
      for (const diff of result.differences) {
        console.log(`  ${diff.address} ${diff.token}: ${diff.old} -> ${diff.new} (delta ${diff.delta})`);
      }
    } catch (error) {
      result.status = "error";
      result.error = error.message;
      report.summary.errors++;
      console.log(`ERROR chain=${sample.chainId} tx=${sample.txHash}: ${error.message}`);
    }
    report.results.push(result);
    writeJson(options.output, report);
  }
  console.log(JSON.stringify(report.summary));
  console.log(`Report: ${options.output}`);
  if (report.summary.errors) process.exitCode = 1;
  else if (options.failOnDiff && report.summary.different) process.exitCode = 2;
  return report;
}

module.exports = { assertCompleteLogs, diffStates, normalizeTrace, validateSamples, main };
if (require.main === module) main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
