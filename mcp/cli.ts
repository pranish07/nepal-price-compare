import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer, envMcpDeps } from "./server";

async function main(): Promise<void> {
  const deps = envMcpDeps();
  if (!deps.apiKey || !deps.model) {
    console.error("Set GEMINI_API_KEY and GEMINI_MODEL before running npm run mcp.");
    process.exit(1);
  }

  const server = createMcpServer(deps);
  await server.connect(new StdioServerTransport());
  console.error("Nepal Price Compare MCP server running on stdio.");
}

void main().catch((error: unknown) => {
  console.error("MCP server failed to start:", error instanceof Error ? error.message : "unknown error");
  process.exit(1);
});
