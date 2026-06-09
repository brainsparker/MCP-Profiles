import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { HostedMcpClient } from "./src/hostedClient.js";

const server = new McpServer({ name: "You.com", version: "3.4.0" });
let serverAnsweredB = false;
server.registerTool(
  "you-search",
  { inputSchema: { query: z.string(), count: z.number().optional(), freshness: z.string().optional() } },
  async (args) => {
    if ((args.query as string).includes("SLOW")) {
      await new Promise((r) => setTimeout(r, 300)); // healthy but slow (free tier)
      serverAnsweredB = true;
    }
    return {
      content: [{ type: "text" as const, text: "ok" }],
      structuredContent: { results: [{ url: "https://example.com/x", title: "t", description: "d" }] },
    };
  },
);

const client = new HostedMcpClient({ url: "https://api.you.com/mcp", freshWindowDays: 180 }, () => {
  const [ct, st] = InMemoryTransport.createLinkedPair();
  void server.connect(st);
  // Simulate one transient POST failure: only the tools/call carrying "FAIL"
  // throws at the transport layer; the session itself is healthy.
  const origSend = ct.send.bind(ct);
  (ct as any).send = async (msg: any, opts?: any) => {
    if (msg?.method === "tools/call" && JSON.stringify(msg.params ?? {}).includes("FAIL")) {
      throw new Error("fetch failed (transient)");
    }
    return origSend(msg, opts);
  };
  return ct;
});

const req = (q: string) => client.search({ query: q, count: 3, params: {}, sendNativeParams: false });

const b = req("SLOW healthy query B");          // in flight, server WILL answer it
await new Promise((r) => setTimeout(r, 50));
const a = req("FAIL transient query A");        // one request-scoped transport failure

const [ra, rb] = await Promise.allSettled([a, b]);
console.log("A:", ra.status, ra.status === "rejected" ? (ra as any).reason?.message : JSON.stringify((ra as any).value));
console.log("B:", rb.status, rb.status === "rejected" ? (rb as any).reason?.message : JSON.stringify((rb as any).value));
await new Promise((r) => setTimeout(r, 400));
console.log("server eventually finished B's handler:", serverAnsweredB);
await client.close();
