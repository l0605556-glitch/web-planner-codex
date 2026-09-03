import type { IncomingMessage, ServerResponse } from "node:http";

import {
  enforceOwnerAuthentication,
  type AuthenticationStateResolver,
} from "../auth/middleware.js";

export type RequestGate = (request: IncomingMessage, response: ServerResponse) => boolean;
export type McpRequestHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => void | Promise<void>;

interface HttpRequestHandlerOptions {
  mcpHandler: McpRequestHandler;
  resolveAuthenticationState: AuthenticationStateResolver;
  validateHost: RequestGate;
  validateOrigin: RequestGate;
}

export function createHttpRequestHandler(options: HttpRequestHandlerOptions): McpRequestHandler {
  return (request, response) => {
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

    if (!options.validateHost(request, response) || !options.validateOrigin(request, response)) {
      return;
    }

    if (!enforceOwnerAuthentication(request, response, options.resolveAuthenticationState)) {
      return;
    }

    return options.mcpHandler(request, response);
  };
}
