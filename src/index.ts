#!/usr/bin/env node

import { createServer } from "node:http";
import path from "node:path";

import { localhostHostValidation, localhostOriginValidation, toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";

import { buildMcpServer } from "./mcp/server.js";
import { WorkspaceService } from "./workspace/service.js";

interface Options {
  workspace: string;
  port: number;
}

function parseOptions(args: readonly string[]): Options {
  let workspace = process.cwd();
  let port = 43_123;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--workspace") {
      const value = args[index + 1];
      if (!value) throw new Error("--workspace requires a directory path.");
      workspace = value;
      index += 1;
    } else if (argument === "--port") {
      const value = Number(args[index + 1]);
      if (!Number.isInteger(value) || value < 1 || value > 65_535) {
        throw new Error("--port requires an integer between 1 and 65535.");
      }
      port = value;
      index += 1;
    } else if (argument === "--help" || argument === "-h") {
      console.log("Usage: npm start -- [--workspace <directory>] [--port <number>]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${String(argument)}`);
    }
  }
  return { workspace: path.resolve(workspace), port };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const workspace = await WorkspaceService.create(options.workspace, { trackedOnly: true });
  const handler = createMcpHandler(() => buildMcpServer(workspace));
  const nodeHandler = toNodeHandler(handler);
  const validateHost = localhostHostValidation();
  const validateOrigin = localhostOriginValidation();

  const httpServer = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && requestUrl.pathname === "/health") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ status: "ok", access: "read-only", workspace: "workspace:/" }));
      return;
    }
    if (requestUrl.pathname !== "/mcp") {
      response.writeHead(404).end();
      return;
    }
    if (!validateHost(request, response) || !validateOrigin(request, response)) return;
    void nodeHandler(request, response);
  });

  const shutdown = async (): Promise<void> => {
    await handler.close();
    httpServer.close();
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());

  httpServer.listen(options.port, "127.0.0.1", () => {
    console.error(`Read-only MCP bridge listening at http://127.0.0.1:${options.port}/mcp`);
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
