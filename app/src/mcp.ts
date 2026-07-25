import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Request, Response } from "express";
import { generateListingTool, inspectConditionTool, verifyRepairTool } from "./tools/index.js";
import { LlmError } from "./llm.js";
import { UploadError } from "./uploads.js";
import { ValidationError } from "./validation.js";

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

async function runTool(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    const result = await fn();
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    const message =
      err instanceof LlmError || err instanceof UploadError || err instanceof ValidationError
        ? err.message
        : "Internal error while running the tool.";
    return { content: [{ type: "text", text: message }], isError: true };
  }
}

function buildServer(): McpServer {
  const server = new McpServer({
    name: "property-management-assistant",
    version: "0.1.0",
  });

  server.registerTool(
    generateListingTool.name,
    { description: generateListingTool.description, inputSchema: generateListingTool.inputShape },
    (args) => runTool(() => generateListingTool.handler(args)),
  );
  server.registerTool(
    inspectConditionTool.name,
    { description: inspectConditionTool.description, inputSchema: inspectConditionTool.inputShape },
    (args) => runTool(() => inspectConditionTool.handler(args)),
  );
  server.registerTool(
    verifyRepairTool.name,
    { description: verifyRepairTool.description, inputSchema: verifyRepairTool.inputShape },
    (args) => runTool(() => verifyRepairTool.handler(args)),
  );

  return server;
}

/**
 * Stateless Streamable HTTP: a fresh server + transport per request, no
 * session bookkeeping — the simplest correct setup for a public demo endpoint.
 */
export async function handleMcpRequest(req: Request, res: Response): Promise<void> {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

export function rejectMcpMethod(_req: Request, res: Response): void {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed. This MCP endpoint is stateless; use POST." },
    id: null,
  });
}
