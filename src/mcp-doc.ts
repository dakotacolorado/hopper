import { Hopper } from "./hopper.ts";
import { serveHopper } from "./server.ts";
import { INSTRUCTIONS } from "./mcp.ts";
import type { AddressInfo } from "node:net";

export interface McpTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: { properties?: Record<string, { type?: string; description?: string }>; required?: string[] };
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
}

/** The server's tools, listed through the running server as a client would, so the files cannot differ from what is served. */
export async function mcpDocument(): Promise<{ instructions: string; tools: McpTool[] }> {
  const hopper = new Hopper(":memory:", { task: async () => null, assign: async () => {}, request: async () => ({ id: "", name: "" }) });
  const server = serveHopper(hopper, "spec", { version: "spec", commit: "spec" });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`, {
      method: "POST",
      headers: { authorization: "Bearer spec", "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    const { result } = (await res.json()) as { result: { tools: McpTool[] } };
    return { instructions: INSTRUCTIONS, tools: result.tools };
  } finally {
    server.close();
    hopper.close();
  }
}

const cell = (text: string | undefined) => (text ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

/** `mcp.json`: the contract an agent's client reads. */
export const renderContract = (doc: { instructions: string; tools: McpTool[] }) => `${JSON.stringify(doc, null, 2)}\n`;

/** `docs/MCP.md`: what hopper is for, the connection, then each tool and its input. */
export function renderMcp(doc: { instructions: string; tools: McpTool[] }): string {
  const lines = [
    "# hopper's MCP server",
    "",
    "<!-- Generated from src/mcp.ts by `npm run spec`; do not edit. -->",
    "",
    "hopper feeds queued [waypoint](https://github.com/dakotacolorado/waypoint) tasks to agents, a few at a time, as they become ready.",
    "Agents that manage a plan use this server to queue its tasks, take them out, and set how many run at once.",
    "",
    "Streamable HTTP at `/mcp`, stateless, answering JSON. Every request takes `Authorization: Bearer $HOPPER_TOKEN`, as the API does.",
    "Each tool does what the API route of the same purpose does; a refusal comes back as the tool's error.",
    "",
    "```json",
    JSON.stringify({ mcpServers: { hopper: { type: "http", url: "https://hopper.example.com/mcp", headers: { Authorization: "Bearer ${HOPPER_TOKEN}" } } } }, null, 2),
    "```",
    "",
    "## Instructions",
    "",
    "What the server tells an agent when it connects:",
    "",
    ...doc.instructions.split("\n").map((line) => (line ? `> ${line}` : ">")),
    "",
    "## Tools",
    "",
    "| Tool | Does | Reads only |",
    "| --- | --- | --- |",
    ...doc.tools.map((tool) => `| [\`${tool.name}\`](#${tool.name}) | ${cell(tool.title)} | ${tool.annotations?.readOnlyHint ? "yes" : ""} |`),
    "",
  ];
  for (const tool of doc.tools) {
    lines.push(`### ${tool.name}`, "", tool.description ?? "", "");
    const rows = Object.entries(tool.inputSchema.properties ?? {}).map(
      ([name, p]) => `| \`${name}\` | ${p.type ?? "any"} | ${tool.inputSchema.required?.includes(name) ? "yes" : ""} | ${cell(p.description)} |`,
    );
    if (rows.length) lines.push("| Input | Type | Required | |", "| --- | --- | --- | --- |", ...rows, "");
    else lines.push("No input.", "");
  }
  return lines.join("\n");
}
