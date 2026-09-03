import { createServer, type Server } from "node:http";

import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";

import { createOwnerAuthenticationResolver } from "./auth/owner-credential.js";
import { createHttpRequestHandler } from "./http/handler.js";
import { createIngressPolicy } from "./http/ingress-policy.js";
import { buildMcpServer } from "./mcp/server.js";
import { loadRemoteConfiguration, type RemoteConfiguration } from "./remote/config.js";
import { WorkspaceService } from "./workspace/service.js";

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export interface BridgeServer {
  httpServer: Server;
  remoteConfiguration: RemoteConfiguration;
  close: () => Promise<void>;
}

export async function createBridgeServer(
  workspaceRoot: string,
  environment: RuntimeEnvironment = process.env,
): Promise<BridgeServer> {
  const remoteConfiguration = loadRemoteConfiguration(environment);
  const resolveAuthenticationState = createOwnerAuthenticationResolver(environment);
  const workspace = await WorkspaceService.create(workspaceRoot, { trackedOnly: true });
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
  let closed = false;

  return {
    httpServer,
    remoteConfiguration,
    close: async () => {
      if (closed) return;
      closed = true;

      const results = await Promise.allSettled([
        handler.close(),
        httpServer.listening
          ? new Promise<void>((resolve, reject) => {
              httpServer.close((error) => {
                if (error) reject(error);
                else resolve();
              });
            })
          : Promise.resolve(),
      ]);
      const failure = results.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
    },
  };
}
