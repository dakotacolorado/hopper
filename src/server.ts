import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { Conflict, type Hopper } from "./hopper.ts";

export interface About {
  version: string;
  commit: string;
}

const PAGE = new URL("../ui/index.html", import.meta.url);

/**
 * hopper's API, for the person and the workplace UI:
 *   GET /health                     {ok, version, commit}, without a token
 *   GET /                           the page
 *   GET /queue                      {limit, entries}
 *   POST /queue {taskId, role?, before?}   queue a task (again: move it)
 *   DELETE /queue/{taskId}          take a queued task out
 *   PUT /limit {limit}              how many it keeps running at once
 *   POST /tick                      look now, rather than at the next tick
 */
export function serveHopper(hopper: Hopper, token: string, about: About): Server {
  const authorized = (req: IncomingMessage) => {
    const given = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? "";
    const a = Buffer.from(given), b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://hopper");
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    };
    const fail = (status: number, message: string) => send(status, { code: status === 404 ? "NotFound" : status === 409 ? "Conflict" : status === 401 ? "Unauthorized" : "BadRequest", message });
    try {
      if (req.method === "GET" && url.pathname === "/health") return send(200, { ok: true, ...about });
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        return void res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(readFileSync(PAGE));
      }
      if (!authorized(req)) return fail(401, "The bearer token is missing or unknown.");
      if (req.method === "GET" && url.pathname === "/queue") return send(200, { limit: hopper.limit, entries: hopper.list() });
      if (req.method === "POST" && url.pathname === "/queue") {
        const body = await json(req);
        if (typeof body.taskId !== "string" || !body.taskId) return fail(400, "taskId is required.");
        const entry = hopper.queue(body.taskId, { role: typeof body.role === "string" ? body.role : undefined, before: typeof body.before === "string" ? body.before : undefined });
        void hopper.tick();
        return send(200, entry);
      }
      const one = /^\/queue\/([^/]+)$/.exec(url.pathname);
      if (req.method === "DELETE" && one) return hopper.dequeue(decodeURIComponent(one[1]!)) ? send(200, { removed: true }) : fail(404, "That task is not queued.");
      if (req.method === "PUT" && url.pathname === "/limit") {
        const body = await json(req);
        hopper.limit = Number(body.limit);
        void hopper.tick();
        return send(200, { limit: hopper.limit });
      }
      if (req.method === "POST" && url.pathname === "/tick") {
        await hopper.tick();
        return send(200, { limit: hopper.limit, entries: hopper.list() });
      }
      return fail(404, `No route ${req.method} ${url.pathname}.`);
    } catch (err) {
      if (err instanceof Conflict) return fail(409, err.message);
      if (err instanceof RangeError || err instanceof SyntaxError) return fail(400, err.message);
      return fail(500, (err as Error).message);
    }
  });
}

async function json(req: IncomingMessage): Promise<Record<string, unknown>> {
  let text = "";
  for await (const chunk of req) text += chunk;
  if (!text) return {};
  const parsed = JSON.parse(text) as unknown;
  if (typeof parsed !== "object" || parsed === null) throw new SyntaxError("The body must be a JSON object.");
  return parsed as Record<string, unknown>;
}

export type { ServerResponse };
