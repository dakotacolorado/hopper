#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Hopper, httpUpstreams } from "./hopper.ts";
import { serveHopper } from "./server.ts";
import { banner, SUMMARY, wantsColor } from "./banner.ts";

const env = process.env;
const fail = (message: string): never => {
  process.stderr.write(`hopper: ${message}\n`);
  process.exit(1);
};
if (process.argv.includes("-h") || process.argv.includes("--help")) {
  process.stdout.write(`hopper: ${SUMMARY}

Usage: hopper [serve]

Environment:
  HOPPER_TOKEN       the bearer token every call but /health and the page presents (required)
  WAYPOINT_URL, WAYPOINT_TOKEN   where tasks are read and assigned (required)
  AGENCY_URL, AGENCY_TOKEN       where agents are asked for (required)
  HOPPER_DB          the SQLite file (default ~/.local/share/hopper/hopper.db)
  HOPPER_HOST, HOPPER_PORT       where it listens (default 127.0.0.1:5000)
  HOPPER_EVERY       seconds between looks (default 30)
`);
  process.exit(0);
}
const need = ["HOPPER_TOKEN", "WAYPOINT_URL", "WAYPOINT_TOKEN", "AGENCY_URL", "AGENCY_TOKEN"].filter((k) => !env[k]?.trim());
if (need.length) fail(`set ${need.join(", ")}`);
const db = env.HOPPER_DB ?? join(homedir(), ".local", "share", "hopper", "hopper.db");
mkdirSync(dirname(db), { recursive: true });
const build = new URL("../build.json", import.meta.url);
const version = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;
const about = existsSync(build) ? (JSON.parse(readFileSync(build, "utf8")) as { version: string; commit: string }) : { version, commit: "unknown" };
const hopper = new Hopper(db, httpUpstreams({ url: env.WAYPOINT_URL!, token: env.WAYPOINT_TOKEN! }, { url: env.AGENCY_URL!, token: env.AGENCY_TOKEN! }));
const host = env.HOPPER_HOST ?? "127.0.0.1";
const port = Number(env.HOPPER_PORT ?? 5000);
const every = Number(env.HOPPER_EVERY ?? 30) * 1000;
const server = serveHopper(hopper, env.HOPPER_TOKEN!, about).listen(port, host, () => {
  const color = wantsColor(env, process.stdout.isTTY);
  process.stdout.write(banner({ version: about.version, commit: about.commit, url: `http://${host}:${port}`, db, every: every / 1000, color }));
});
const timer = setInterval(() => void hopper.tick().catch((err: unknown) => process.stderr.write(`hopper: tick: ${(err as Error).message}\n`)), every);
void hopper.tick();
const stop = () => {
  clearInterval(timer);
  server.close();
  hopper.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
