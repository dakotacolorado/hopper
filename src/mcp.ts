import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Conflict, type Hopper } from "./hopper.ts";
import { SUMMARY } from "./banner.ts";

export const INSTRUCTIONS = `hopper: ${SUMMARY}

For agents that manage a plan: queue its tasks here and hopper starts an agent on each, once waypoint says the task is ready and there is room under the limit.

- A queued task starts in queue order, but only when waypoint says it is ready (open, nothing it depends on still open, nobody assigned); until then its entry says why it waits.
- The limit is how many of hopper's tasks run at once; a task counts against it until waypoint shows it done or cancelled. A higher limit spends more tokens; 0 pauses hopper.
- hopper looks every 30 seconds; queue_task and set_limit also look at once.`;

const text = (body: unknown, isError = false) => ({ content: [{ type: "text" as const, text: JSON.stringify(body, null, 2) }], ...(isError && { isError: true }) });

/** The MCP server for one request: each tool does what the HTTP route of the same name does, on the same `Hopper`. */
export function mcpServer(version: string, hopper: Hopper): McpServer {
  const server = new McpServer({ name: "hopper", version }, { instructions: INSTRUCTIONS });
  const state = () => ({ limit: hopper.limit, entries: hopper.list() });
  const run = async (work: () => unknown | Promise<unknown>) => {
    try {
      return text(await work());
    } catch (err) {
      if (err instanceof Conflict || err instanceof RangeError) return text({ message: err.message }, true);
      throw err;
    }
  };

  server.registerTool(
    "list_queue",
    {
      title: "List queue",
      description: "Returns the limit and every entry: queued ones first in order, then started, finished and dropped, each with its state and why it waits. hopper starts an agent on each queued task once waypoint says it is ready and there is room under the limit.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    () => run(state),
  );
  server.registerTool(
    "queue_task",
    {
      title: "Queue task",
      description: "Queues a waypoint task at the back, or before another queued one; queuing a task again moves it. hopper starts an agent on it once waypoint says it is ready and there is room under the limit.",
      inputSchema: {
        taskId: z.string().min(1).describe("The waypoint task's ID."),
        role: z.string().optional().describe("The role of the agent started on it. Default implementer."),
        before: z.string().optional().describe("The ID of a queued task to go in front of. Default: the back."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    ({ taskId, role, before }) =>
      run(() => {
        const entry = hopper.queue(taskId, { role, before });
        void hopper.tick();
        return entry;
      }),
  );
  server.registerTool(
    "dequeue_task",
    {
      title: "Dequeue task",
      description: "Takes a queued task out of the queue, so no agent is started on it.",
      inputSchema: { taskId: z.string().min(1).describe("The waypoint task's ID.") },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    ({ taskId }) => run(() => (hopper.dequeue(taskId) ? { removed: true } : Promise.reject(new RangeError("That task is not queued.")))),
  );
  server.registerTool(
    "set_limit",
    {
      title: "Set limit",
      description: "Sets how many of hopper's tasks run at once, from 0 to 50; 0 pauses it. A higher limit starts more agents at once and so spends more tokens.",
      inputSchema: { limit: z.number().int().min(0).max(50).describe("How many tasks may run at once.") },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    ({ limit }) =>
      run(() => {
        hopper.limit = limit;
        void hopper.tick();
        return { limit: hopper.limit };
      }),
  );
  server.registerTool(
    "tick",
    {
      title: "Tick",
      description: "Looks at the queue now, rather than at the next tick, starting agents on tasks that are ready and fit under the limit. Returns the limit and entries.",
      inputSchema: {},
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    () =>
      run(async () => {
        await hopper.tick();
        return state();
      }),
  );
  return server;
}
