#!/usr/bin/env node

import path from "node:path";

import { LOOPBACK_BIND_HOST } from "./remote/config.js";
import { createBridgeServer } from "./server.js";

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
  const bridge = await createBridgeServer(options.workspace);
  process.once("SIGINT", () => void bridge.close());
  process.once("SIGTERM", () => void bridge.close());

  bridge.httpServer.listen(options.port, LOOPBACK_BIND_HOST, () => {
    console.error(
      `Read-only MCP bridge listening in ${bridge.remoteConfiguration.mode} mode at http://${LOOPBACK_BIND_HOST}:${options.port}/mcp`,
    );
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
