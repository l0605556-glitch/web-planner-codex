import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import type { OwnerAuthenticationState } from "../src/auth/contract.js";
import { createHttpRequestHandler, type RequestGate } from "../src/http/handler.js";

interface HttpResult {
  body: string;
  statusCode: number;
}

interface HarnessOptions {
  authenticationError?: Error;
  authenticationState?: OwnerAuthenticationState;
  validateHost?: RequestGate;
  validateOrigin?: RequestGate;
}

const openServers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

async function startHarness(options: HarnessOptions = {}) {
  let authenticationCalls = 0;
  let mcpCalls = 0;

  const handler = createHttpRequestHandler({
    mcpHandler: (_request, response) => {
      mcpCalls += 1;
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      response.end("mcp reached");
    },
    resolveAuthenticationState: () => {
      authenticationCalls += 1;
      if (options.authenticationError) {
        throw options.authenticationError;
      }
      return options.authenticationState ?? "authenticated-owner";
    },
    validateHost: options.validateHost ?? (() => true),
    validateOrigin: options.validateOrigin ?? (() => true),
  });

  const server = createServer(handler);
  openServers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const { port } = server.address() as AddressInfo;
  return {
    get authenticationCalls() {
      return authenticationCalls;
    },
    get mcpCalls() {
      return mcpCalls;
    },
    request(path: string, method = "GET"): Promise<HttpResult> {
      return new Promise((resolve, reject) => {
        const outgoing = request(
          { host: "127.0.0.1", method, path, port },
          (response) => {
            const chunks: Buffer[] = [];
            response.on("data", (chunk: Buffer) => chunks.push(chunk));
            response.on("end", () => {
              resolve({
                body: Buffer.concat(chunks).toString("utf8"),
                statusCode: response.statusCode ?? 0,
              });
            });
          },
        );
        outgoing.once("error", reject);
        outgoing.end();
      });
    },
  };
}

describe("HTTP authentication boundary", () => {
  it("keeps the health endpoint outside authentication and MCP dispatch", async () => {
    const harness = await startHarness({ authenticationState: "missing" });

    const result = await harness.request("/health");

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({
      status: "ok",
      access: "read-only",
      workspace: "workspace:/",
    });
    expect(harness.authenticationCalls).toBe(0);
    expect(harness.mcpCalls).toBe(0);
  });

  it("keeps non-MCP routes as 404 without authenticating", async () => {
    const harness = await startHarness();

    const result = await harness.request("/unknown");

    expect(result.statusCode).toBe(404);
    expect(harness.authenticationCalls).toBe(0);
    expect(harness.mcpCalls).toBe(0);
  });

  it.each<OwnerAuthenticationState>(["missing", "malformed", "invalid"])(
    "rejects %s credentials with one generic response before MCP dispatch",
    async (authenticationState) => {
      const harness = await startHarness({ authenticationState });

      const result = await harness.request("/mcp", "POST");

      expect(result.statusCode).toBe(401);
      expect(result.body).toBe('{"error":"unauthorized"}');
      expect(harness.authenticationCalls).toBe(1);
      expect(harness.mcpCalls).toBe(0);
    },
  );

  it("allows the authenticated owner to reach MCP dispatch", async () => {
    const harness = await startHarness({ authenticationState: "authenticated-owner" });

    const result = await harness.request("/mcp", "POST");

    expect(result).toEqual({ statusCode: 200, body: "mcp reached" });
    expect(harness.authenticationCalls).toBe(1);
    expect(harness.mcpCalls).toBe(1);
  });

  it("fails closed without exposing authentication resolver errors", async () => {
    const harness = await startHarness({
      authenticationError: new Error("private verification detail"),
    });

    const result = await harness.request("/mcp", "POST");

    expect(result).toEqual({ statusCode: 401, body: '{"error":"unauthorized"}' });
    expect(result.body).not.toContain("private verification detail");
    expect(harness.mcpCalls).toBe(0);
  });

  it("retains host and origin gates before authentication", async () => {
    let originCalls = 0;
    const harness = await startHarness({
      validateHost: (_request, response) => {
        response.writeHead(403).end();
        return false;
      },
      validateOrigin: () => {
        originCalls += 1;
        return true;
      },
    });

    const result = await harness.request("/mcp", "POST");

    expect(result.statusCode).toBe(403);
    expect(originCalls).toBe(0);
    expect(harness.authenticationCalls).toBe(0);
    expect(harness.mcpCalls).toBe(0);
  });
});
