#!/usr/bin/env node
/**
 * Minimal MCP stdio client for smoke-testing the you-aware server.
 * No dependencies — speaks newline-delimited JSON-RPC directly.
 *
 * Usage (from the repo root, after `npm run build`):
 *   node test-harness/mcp-client.mjs [--server dist/index.js] [--cwd <projectRoot>] \
 *     [--scenario list|search|full] [--query "..."] [--env KEY=VAL ...]
 *
 * Exits 0 when every check passes, 1 otherwise.
 */
import { spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DEFAULT_SERVER = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");

function parseArgs(argv) {
  const out = {
    env: {},
    scenario: "full",
    query: "best way to handle date parsing in this project",
    server: DEFAULT_SERVER,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--server") out.server = argv[++i];
    else if (a === "--cwd") out.cwd = argv[++i];
    else if (a === "--scenario") out.scenario = argv[++i];
    else if (a === "--query") out.query = argv[++i];
    else if (a === "--env") {
      const [k, ...rest] = argv[++i].split("=");
      out.env[k] = rest.join("=");
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

const child = spawn("node", [args.server], {
  cwd: args.cwd ?? process.cwd(),
  env: { ...process.env, ...args.env },
  stdio: ["pipe", "pipe", "pipe"],
});

let stderrBuf = "";
child.stderr.on("data", (d) => (stderrBuf += d.toString()));

let buf = "";
const pending = new Map();
let nextId = 1;

child.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  let idx;
  while ((idx = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      console.error("[client] non-JSON line from server:", line.slice(0, 200));
      continue;
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`RPC error ${msg.error.code}: ${msg.error.message}`));
      else resolve(msg.result);
    }
  }
});

function rpc(method, params, timeoutMs = 30000) {
  const id = nextId++;
  const p = new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }
    }, timeoutMs);
  });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return p;
}

function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

let failures = 0;
function check(label, cond, detail = "") {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${detail ? " — " + detail : ""}`);
}

async function main() {
  // 1. Handshake
  const init = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "hyperagent-smoke", version: "1.0.0" },
  });
  check("initialize handshake", !!init.serverInfo, JSON.stringify(init.serverInfo));
  check("server name is you-aware", init.serverInfo?.name === "you-aware");
  notify("notifications/initialized", {});

  // 2. Tool discovery
  const tools = await rpc("tools/list", {});
  const names = (tools.tools ?? []).map((t) => t.name).sort();
  console.log("[info] tools:", names.join(", "));
  check("search tool exposed", names.includes("search"));
  const searchTool = tools.tools.find((t) => t.name === "search");
  const props = Object.keys(searchTool?.inputSchema?.properties ?? {}).sort();
  check(
    "search schema has 5 documented params",
    ["blocked_sources", "freshness", "project_context", "query", "trusted_sources"].every((p) => props.includes(p)),
    props.join(","),
  );
  if (args.scenario === "list") return finish();

  // 3. Search call
  const res = await rpc("tools/call", {
    name: "search",
    arguments: { query: args.query },
  }, 60000);
  const text = (res.content ?? []).map((c) => c.text ?? "").join("\n");
  console.log("[info] search isError:", !!res.isError);
  console.log("----- search response (first 3500 chars) -----");
  console.log(text.slice(0, 3500));
  console.log("----- end response -----");

  if (args.scenario === "search") return finish();

  // 4. report_outcome (only when memory enabled / tool present)
  if (names.includes("report_outcome")) {
    const urlMatch = text.match(/https?:\/\/[^\s"\\)\]]+/);
    const cited = urlMatch ? [urlMatch[0]] : ["https://example.com/"];
    const out = await rpc("tools/call", { name: "report_outcome", arguments: { cited_urls: cited } }, 30000);
    const outText = (out.content ?? []).map((c) => c.text ?? "").join("\n");
    console.log("[info] report_outcome isError:", !!out.isError);
    console.log("[info] report_outcome:", outText.slice(0, 600));
  } else {
    console.log("[info] report_outcome not exposed (memory off?)");
  }
  return finish();
}

function finish() {
  child.kill();
  if (stderrBuf.trim()) {
    console.log("----- server stderr (first 1500 chars) -----");
    console.log(stderrBuf.slice(0, 1500));
  }
  console.log(failures === 0 ? "RESULT: ALL CHECKS PASSED" : `RESULT: ${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("[client] fatal:", e.message);
  child.kill();
  if (stderrBuf.trim()) console.error("server stderr:", stderrBuf.slice(0, 1500));
  process.exit(1);
});
