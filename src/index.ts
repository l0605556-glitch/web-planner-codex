#!/usr/bin/env node

import { createServer } from "node:http";
import path from "node:path";

import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";

import { createOwnerAuthenticationResolver } from "./auth/owner-credential.js";
import { createHttpRequestHandler } from "./http/handler.js";
import { createIngressPolicy } from "./http/ingress-policy.js";
import { buildMcpServer } from "./mcp/server.js";
import { loadRemoteConfiguration, LOOPBACK_BIND_HOST } from "./remote/config.js";
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
  const remoteConfiguration = loadRemoteConfiguration();
  const resolveAuthenticationState = createOwnerAuthenticationResolver();
  const workspace = await WorkspaceService.create(options.workspace, { trackedOnly: true });
  const handler = createMcpHandler(() => buildMcpServer(workspace));
  const nodeHandler = toNodeHandler(handler);
  const { validateHost, validateOrigin } = createIngressPolicy(remoteConfiguration);

  const httpServer = createServer(
    createHttpRequestHandler({
      mcpHandler: nodeHandler,
      resolveAuthenticationState,
      validateHost,
      validateOrigin,
    }),
  );

  const shutdown = async (): Promise<void> => {
    await handler.close();
    httpServer.close();
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());

  httpServer.listen(options.port, LOOPBACK_BIND_HOST, () => {
    console.error(
      `Read-only MCP bridge listening in ${remoteConfiguration.mode} mode at http://${LOOPBACK_BIND_HOST}:${options.port}/mcp`,
    );
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
