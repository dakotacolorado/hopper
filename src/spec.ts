import { mkdirSync, writeFileSync } from "node:fs";
import { mcpDocument, renderContract, renderMcp } from "./mcp-doc.ts";

const doc = await mcpDocument();
mkdirSync(new URL("../docs/", import.meta.url), { recursive: true });
writeFileSync(new URL("../mcp.json", import.meta.url), renderContract(doc));
writeFileSync(new URL("../docs/MCP.md", import.meta.url), renderMcp(doc));
