import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { Hopper, type Task, type Upstreams } from "./hopper.ts";
import { serveHopper } from "./server.ts";

function setup(tasks: Record<string, Partial<Task>>) {
  const requested: string[] = [];
  const up: Upstreams = {
    async task(id) {
      const t = tasks[id];
      return t ? { id, shortId: id.slice(0, 8), title: id, status: "backlog", ready: true, assignee: null, criteria: [], ...t } : null;
    },
    async assign() {},
    async request(_role, _brief, taskId) {
      requested.push(taskId);
      return { id: `req${requested.length}0000000`, name: `implementer-${requested.length}` };
    },
  };
  const hopper = new Hopper(":memory:", up);
  const server = serveHopper(hopper, "secret", { version: "1.2.3", commit: "abc" });
  return new Promise<{ url: string; hopper: Hopper; requested: string[]; close: () => void }>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, hopper, requested, close: () => { server.close(); hopper.close(); } })),
  );
}

let id = 0;
const rpc = (url: string, method: string, params: unknown, token: string | null = "secret") =>
  fetch(`${url}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(token && { authorization: `Bearer ${token}` }) },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
const call = async (url: string, name: string, args: Record<string, unknown> = {}) => {
  const res = await rpc(url, "tools/call", { name, arguments: args });
  assert.equal(res.status, 200);
  const { result } = (await res.json()) as { result: { content: { text: string }[]; isError?: boolean } };
  return { body: JSON.parse(result.content[0]!.text) as any, isError: result.isError === true };
};

test("/mcp is refused without the token and lists the five tools with it", async () => {
  const s = await setup({});
  try {
    assert.equal((await rpc(s.url, "tools/list", {}, null)).status, 401);
    assert.equal((await rpc(s.url, "tools/list", {}, "wrong")).status, 401);
    const init = await rpc(s.url, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    const { result: info } = (await init.json()) as { result: { instructions: string; serverInfo: { name: string } } };
    assert.equal(info.serverInfo.name, "hopper");
    assert.match(info.instructions, /^hopper: /);
    const { result } = (await (await rpc(s.url, "tools/list", {})).json()) as { result: { tools: { name: string }[] } };
    assert.deepEqual(result.tools.map((t) => t.name), ["list_queue", "queue_task", "dequeue_task", "set_limit", "tick"]);
  } finally {
    s.close();
  }
});

test("each tool does what its HTTP route does", async () => {
  const s = await setup({ a: {}, b: { ready: false }, c: {} });
  const api = async (method: string, path: string, body?: unknown) =>
    (await fetch(s.url + path, { method, headers: { authorization: "Bearer secret", "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json() as Promise<any>;
  try {
    s.hopper.limit = 0;
    assert.deepEqual((await call(s.url, "list_queue")).body, await api("GET", "/queue"));
    const queued = await call(s.url, "queue_task", { taskId: "b" });
    assert.equal(queued.body.taskId, "b");
    await call(s.url, "queue_task", { taskId: "a" });
    await call(s.url, "queue_task", { taskId: "c", role: "reviewer", before: "b" });
    const list = (await call(s.url, "list_queue")).body;
    assert.deepEqual(list, await api("GET", "/queue"));
    assert.deepEqual(list.entries.map((e: any) => e.taskId), ["c", "b", "a"]);
    assert.equal(list.entries[0].role, "reviewer");

    assert.deepEqual((await call(s.url, "dequeue_task", { taskId: "c" })).body, { removed: true });
    assert.deepEqual((await call(s.url, "list_queue")).body.entries.map((e: any) => e.taskId), ["b", "a"]);
    const gone = await call(s.url, "dequeue_task", { taskId: "c" });
    assert.equal(gone.isError, true);
    assert.equal(gone.body.message, "That task is not queued.");

    assert.deepEqual((await call(s.url, "set_limit", { limit: 3 })).body, { limit: 3 });
    assert.equal(s.hopper.limit, 3);
    const bad = await rpc(s.url, "tools/call", { name: "set_limit", arguments: { limit: 51 } });
    const { result } = (await bad.json()) as { result: { isError?: boolean } };
    assert.equal(result.isError, true);
    assert.equal(s.hopper.limit, 3);

    // set_limit looked at once, in the background; let that look end before this one.
    while (s.requested.length === 0) await new Promise((r) => setTimeout(r, 5));
    const ticked = (await call(s.url, "tick")).body;
    assert.deepEqual(ticked, await api("POST", "/tick"));
    assert.deepEqual(s.requested, ["a"], "a is ready and b is not");
    assert.equal(ticked.entries.find((e: any) => e.taskId === "a").state, "started");
  } finally {
    s.close();
  }
});

test("mcp.json and docs/MCP.md are what the server serves; run `npm run spec` after a change", async () => {
  const { readFileSync } = await import("node:fs");
  const { mcpDocument, renderContract, renderMcp } = await import("./mcp-doc.ts");
  const doc = await mcpDocument();
  assert.equal(readFileSync(new URL("../mcp.json", import.meta.url), "utf8"), renderContract(doc));
  assert.equal(readFileSync(new URL("../docs/MCP.md", import.meta.url), "utf8"), renderMcp(doc));
});
