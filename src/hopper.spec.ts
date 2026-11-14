import { test } from "node:test";
import assert from "node:assert/strict";
import { Hopper, type Task, type Upstreams } from "./hopper.ts";
import { serveHopper } from "./server.ts";

function fake(tasks: Record<string, Partial<Task>>) {
  const requested: { role: string; taskId: string }[] = [];
  const assigned: Record<string, string> = {};
  let n = 0;
  const up: Upstreams = {
    async task(id) {
      const t = tasks[id];
      if (!t) return null;
      return { id, shortId: id.slice(0, 8), title: `task ${id}`, status: "backlog", ready: true, assignee: null, criteria: [], ...t };
    },
    async assign(taskId, name) {
      assigned[taskId] = name;
    },
    async request(role, _brief, taskId) {
      requested.push({ role, taskId });
      const id = `req${++n}0000000`;
      return { id, name: `${role}-${id.slice(0, 8)}` };
    },
  };
  return { up, requested, assigned };
}

test("starts queued tasks in order, up to the limit", async () => {
  const f = fake({ a: {}, b: {}, c: {} });
  const h = new Hopper(":memory:", f.up);
  h.limit = 2;
  for (const id of ["a", "b", "c"]) h.queue(id);
  await h.tick();
  assert.deepEqual(f.requested.map((r) => r.taskId), ["a", "b"]);
  assert.equal(f.assigned.a, "implementer-req10000");
  assert.deepEqual(["a", "b", "c"].map((id) => h.get(id)?.state), ["started", "started", "queued"]);
  assert.equal(h.list()[0]?.taskId, "c", "the queue comes first");
});

test("a closed task frees its room; a blocked or assigned one keeps its place", async () => {
  const tasks: Record<string, Partial<Task>> = { a: {}, b: { ready: false }, c: { assignee: "someone" }, d: {} };
  const f = fake(tasks);
  const h = new Hopper(":memory:", f.up);
  h.limit = 1;
  for (const id of ["a", "b", "c", "d"]) h.queue(id);
  await h.tick();
  assert.deepEqual(f.requested.map((r) => r.taskId), ["a"]);
  tasks.a = { status: "done" };
  await h.tick();
  assert.equal(h.get("a")?.state, "finished");
  assert.deepEqual(f.requested.map((r) => r.taskId), ["a", "d"]);
  assert.match(h.get("b")?.note ?? "", /blocked/);
  assert.match(h.get("c")?.note ?? "", /assigned to someone/);
});

test("drops a task that is gone or closed, and moves one queued before another", async () => {
  const f = fake({ b: { status: "cancelled" }, c: {}, d: {} });
  const h = new Hopper(":memory:", f.up);
  h.limit = 0;
  h.queue("a");
  h.queue("b");
  h.queue("c");
  h.queue("d", { before: "c" });
  assert.deepEqual(h.list().map((e) => e.taskId), ["a", "b", "d", "c"]);
  h.limit = 5;
  await h.tick();
  assert.equal(h.get("a")?.state, "dropped");
  assert.equal(h.get("b")?.state, "dropped");
  assert.deepEqual(f.requested.map((r) => r.taskId), ["d", "c"]);
  assert.throws(() => h.queue("d"), /already started/);
  assert.equal(h.dequeue("d"), false);
});

test("its API needs the token, but not for health", async () => {
  const h = new Hopper(":memory:", fake({ a: {} }).up);
  const server = serveHopper(h, "secret-token", { version: "0.1.0", commit: "abc" });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    assert.deepEqual(await (await fetch(`${base}/health`)).json(), { ok: true, version: "0.1.0", commit: "abc" });
    assert.equal((await fetch(`${base}/queue`)).status, 401);
    const auth = { authorization: "Bearer secret-token", "content-type": "application/json" };
    assert.equal((await fetch(`${base}/queue`, { method: "POST", headers: auth, body: JSON.stringify({ taskId: "a" }) })).status, 200);
    assert.equal((await fetch(`${base}/limit`, { method: "PUT", headers: auth, body: JSON.stringify({ limit: 99 }) })).status, 400);
    const q = (await (await fetch(`${base}/queue`, { headers: auth })).json()) as { entries: unknown[] };
    assert.equal(q.entries.length, 1);
    assert.match(await (await fetch(`${base}/`)).text(), /<title>hopper<\/title>/);
  } finally {
    server.close();
    h.close();
  }
});
