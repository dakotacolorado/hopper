import { DatabaseSync } from "node:sqlite";

/** A task as hopper reads it from waypoint. */
export interface Task {
  id: string;
  shortId: string;
  title: string;
  status: "backlog" | "in_progress" | "review" | "done" | "cancelled";
  ready: boolean;
  assignee: string | null;
  criteria: { id: string; text: string; met: boolean }[];
  /** Loose data waypoint stores for tools like hopper; `hostLabels` and `difficulty` are the keys read. */
  metadata?: Record<string, unknown>;
}

/** One task in the queue, and what hopper did with it. */
export interface Entry {
  taskId: string;
  position: number;
  role: string;
  state: "queued" | "started" | "finished" | "dropped";
  /** Why it has not started, or why it was dropped. */
  note: string | null;
  requestId: string | null;
  agentName: string | null;
  queuedAt: string;
  startedAt: string | null;
}

/** What hopper calls: waypoint for tasks, agency for agents. */
export interface Upstreams {
  task(id: string): Promise<Task | null>;
  assign(taskId: string, agentName: string): Promise<void>;
  /**
   * Asks agency for an agent in `role` on the task; agency starts it when usage and a host allow,
   * on a host carrying every one of `labels`, at `capability` (1 easy, 2 medium, 3 hard), or the role's
   * default when it is null.
   */
  request(role: string, brief: string, taskId: string, labels: string[], capability: number | null): Promise<{ id: string; name: string }>;
}

export const DEFAULT_ROLE = "implementer";
export const DEFAULT_LIMIT = 2;
const OPEN = new Set(["backlog", "in_progress", "review"]);

/** The first message of an agent started on `task`, as the workplace UI's Start writes it. */
export function briefFor(task: Task): string {
  const lines = [
    `Work on waypoint task ${task.shortId}: ${task.title}`,
    "",
    `Read it in full first: GetTask ${task.id} on the waypoint MCP server, or \`curl -H "Authorization: Bearer $WAYPOINT_TOKEN" "$WAYPOINT_URL/tasks/${task.id}"\`, with its comments (\`/tasks/${task.id}/comments\`).`,
  ];
  if (task.criteria.length) {
    lines.push("", "It is done when:");
    for (const c of task.criteria) lines.push(`- [${c.met ? "x" : " "}] ${c.id}: ${c.text}`);
  }
  lines.push(
    "",
    "Move it to `in_progress` as you start. Mark each criterion met once you have seen it hold yourself. When your change is submitted, move the task to `review` and say so with your status; the person closes it.",
  );
  return lines.join("\n");
}

/**
 * The agency host labels a task's worker needs: its `metadata.hostLabels`, `[]` when it has none.
 * Throws when `hostLabels` is there but is not a list of non-empty strings.
 */
export function hostLabelsOf(task: Task): string[] {
  const value = task.metadata?.hostLabels;
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((l) => typeof l === "string" && l.length > 0)) {
    throw new TypeError("metadata.hostLabels must be a list of host labels");
  }
  return value as string[];
}

/**
 * The capability a task's worker needs: its `metadata.difficulty` (1 easy, 2 medium, 3 hard), null when it has none.
 * Throws when `difficulty` is there but is not 1, 2 or 3.
 */
export function difficultyOf(task: Task): 1 | 2 | 3 | null {
  const value = task.metadata?.difficulty;
  if (value === undefined) return null;
  if (value !== 1 && value !== 2 && value !== 3) throw new TypeError("metadata.difficulty must be 1, 2 or 3");
  return value;
}

export class Hopper {
  readonly db: DatabaseSync;
  private readonly up: Upstreams;
  private readonly now: () => Date;
  private ticking = false;

  constructor(path: string, up: Upstreams, now: () => Date = () => new Date()) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS entries (
        task_id TEXT PRIMARY KEY, position REAL NOT NULL, role TEXT NOT NULL, state TEXT NOT NULL,
        note TEXT, request_id TEXT, agent_name TEXT, queued_at TEXT NOT NULL, started_at TEXT);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    this.up = up;
    this.now = now;
  }

  close(): void {
    this.db.close();
  }

  get limit(): number {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'limit'").get() as { value: string } | undefined;
    return row ? Number(row.value) : DEFAULT_LIMIT;
  }

  set limit(n: number) {
    if (!Number.isInteger(n) || n < 0 || n > 50) throw new RangeError("limit must be a whole number from 0 to 50");
    this.db.prepare("INSERT INTO settings (key, value) VALUES ('limit', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(n));
  }

  /** Every entry, the queue in order first, then what was started, newest first. */
  list(): Entry[] {
    const rows = this.db.prepare("SELECT * FROM entries ORDER BY CASE state WHEN 'queued' THEN 0 WHEN 'started' THEN 1 ELSE 2 END, CASE state WHEN 'queued' THEN position END, started_at DESC, queued_at DESC").all() as Record<string, unknown>[];
    return rows.map(entryOf);
  }

  get(taskId: string): Entry | null {
    const row = this.db.prepare("SELECT * FROM entries WHERE task_id = ?").get(taskId) as Record<string, unknown> | undefined;
    return row ? entryOf(row) : null;
  }

  /** Queues a task at the back (or `before` another queued one); queuing it again moves it. */
  queue(taskId: string, options: { role?: string; before?: string } = {}): Entry {
    const existing = this.get(taskId);
    if (existing && existing.state === "started") throw new Conflict(`${taskId} is already started, as ${existing.agentName ?? "an agent"}.`);
    const before = options.before ? this.get(options.before) : null;
    if (options.before && (!before || before.state !== "queued")) throw new Conflict(`${options.before} is not queued.`);
    const position = before ? this.positionBefore(before.position) : this.backPosition();
    const role = options.role ?? existing?.role ?? DEFAULT_ROLE;
    this.db
      .prepare(`INSERT INTO entries (task_id, position, role, state, note, request_id, agent_name, queued_at, started_at)
        VALUES (?, ?, ?, 'queued', NULL, NULL, NULL, ?, NULL)
        ON CONFLICT(task_id) DO UPDATE SET position = excluded.position, role = excluded.role, state = 'queued', note = NULL, request_id = NULL, agent_name = NULL, started_at = NULL`)
      .run(taskId, position, role, this.now().toISOString());
    return this.get(taskId)!;
  }

  /** Takes a queued task out of the queue. */
  dequeue(taskId: string): boolean {
    return Number(this.db.prepare("DELETE FROM entries WHERE task_id = ? AND state = 'queued'").run(taskId).changes) > 0;
  }

  private backPosition(): number {
    const row = this.db.prepare("SELECT MAX(position) AS p FROM entries WHERE state = 'queued'").get() as { p: number | null };
    return (row.p ?? 0) + 1;
  }

  private positionBefore(at: number): number {
    const row = this.db.prepare("SELECT MAX(position) AS p FROM entries WHERE state = 'queued' AND position < ?").get(at) as { p: number | null };
    return ((row.p ?? at - 1) + at) / 2;
  }

  private set(taskId: string, fields: Partial<Pick<Entry, "state" | "note" | "requestId" | "agentName" | "startedAt">>): void {
    const cols: Record<string, string> = { state: "state", note: "note", requestId: "request_id", agentName: "agent_name", startedAt: "started_at" };
    const keys = Object.keys(fields) as (keyof typeof fields)[];
    this.db.prepare(`UPDATE entries SET ${keys.map((k) => `${cols[k]} = ?`).join(", ")} WHERE task_id = ?`).run(...keys.map((k) => fields[k] ?? null), taskId);
  }

  /**
   * One look: what was started and has closed in waypoint is finished, freeing room; then, while
   * fewer than `limit` are running, the next queued task that waypoint says is ready and has no
   * assignee is started through agency, in queue order. A task not ready yet keeps its place.
   */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      for (const entry of this.list().filter((e) => e.state === "started")) {
        const task = await this.up.task(entry.taskId).catch(() => undefined);
        if (task === null || (task && !OPEN.has(task.status))) this.set(entry.taskId, { state: "finished", note: task ? `task ${task.status}` : "task deleted" });
      }
      let running = this.list().filter((e) => e.state === "started").length;
      for (const entry of this.list().filter((e) => e.state === "queued")) {
        if (running >= this.limit) break;
        const task = await this.up.task(entry.taskId).catch((err: unknown) => {
          this.set(entry.taskId, { note: `waypoint: ${(err as Error).message}` });
          return undefined;
        });
        if (task === undefined) continue;
        if (task === null) {
          this.set(entry.taskId, { state: "dropped", note: "no such task in waypoint" });
          continue;
        }
        if (!OPEN.has(task.status)) {
          this.set(entry.taskId, { state: "dropped", note: `task is ${task.status}` });
          continue;
        }
        if (task.assignee) {
          this.set(entry.taskId, { note: `waits: assigned to ${task.assignee}` });
          continue;
        }
        if (!task.ready) {
          this.set(entry.taskId, { note: "waits: blocked by another task" });
          continue;
        }
        let labels: string[];
        let capability: number | null;
        try {
          labels = hostLabelsOf(task);
          capability = difficultyOf(task);
        } catch (err) {
          this.set(entry.taskId, { note: `waits: ${(err as Error).message}` });
          continue;
        }
        try {
          const made = await this.up.request(entry.role, briefFor(task), task.id, labels, capability);
          this.set(entry.taskId, { state: "started", note: null, requestId: made.id, agentName: made.name, startedAt: this.now().toISOString() });
          running++;
          await this.up.assign(task.id, made.name).catch(() => {});
        } catch (err) {
          this.set(entry.taskId, { note: `agency: ${(err as Error).message}` });
        }
      }
    } finally {
      this.ticking = false;
    }
  }
}

export class Conflict extends Error {}

function entryOf(r: Record<string, unknown>): Entry {
  return {
    taskId: r.task_id as string,
    position: r.position as number,
    role: r.role as string,
    state: r.state as Entry["state"],
    note: (r.note as string | null) ?? null,
    requestId: (r.request_id as string | null) ?? null,
    agentName: (r.agent_name as string | null) ?? null,
    queuedAt: r.queued_at as string,
    startedAt: (r.started_at as string | null) ?? null,
  };
}

/** waypoint and agency over HTTP, with their tokens. */
export function httpUpstreams(waypoint: { url: string; token: string }, agency: { url: string; token: string }, actor = "hopper"): Upstreams {
  const call = async (base: { url: string; token: string }, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(`${base.url.replace(/\/$/, "")}${path}`, {
      method,
      headers: { authorization: `Bearer ${base.token}`, ...(body !== undefined && { "content-type": "application/json" }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    return { status: res.status, json: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
  };
  return {
    async task(id) {
      const res = await call(waypoint, "GET", `/tasks/${encodeURIComponent(id)}`);
      if (res.status === 404) return null;
      if (res.status !== 200) throw new Error(`GetTask answered ${res.status}`);
      return ((res.json.task ?? res.json) as unknown) as Task;
    },
    async assign(taskId, agentName) {
      const res = await call(waypoint, "PATCH", `/tasks/${encodeURIComponent(taskId)}`, { assignee: agentName }, { "x-actor": actor });
      if (res.status !== 200) throw new Error(`UpdateTask answered ${res.status}`);
    },
    async request(role, brief, taskId, labels, capability) {
      const body = { role, brief, item: taskId, ...(labels.length > 0 && { labels }), ...(capability !== null && { capability }) };
      const res = await call(agency, "POST", "/requests", body, { "claimed-by": actor });
      if (res.status !== 200 && res.status !== 201 && res.status !== 202) throw new Error(`CreateRequest answered ${res.status}: ${String(res.json.message ?? "")}`);
      const id = res.json.id as string;
      return { id, name: `${role.slice(0, 31)}-${id.slice(0, 8)}` };
    },
  };
}
