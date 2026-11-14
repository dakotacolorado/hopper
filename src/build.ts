// Writes build.json: the version and the commit, read once at build so the image needs no git.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const version = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;
let commit = "unknown";
try {
  commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
} catch {}
writeFileSync(new URL("../build.json", import.meta.url), JSON.stringify({ version, commit }) + "\n");
console.log(`build.json: ${version} ${commit}`);
