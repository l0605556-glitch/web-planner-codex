import { randomBytes } from "node:crypto";
import {
  createServer,
  request,
  type OutgoingHttpHeaders,
  type Server,
} from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import type { OwnerAuthenticationState } from "../src/auth/contract.js";
import type { AuthenticationStateResolver } from "../src/auth/middleware.js";
import {
  createOwnerAuthenticationResolver,
  OWNER_TOKEN_ENVIRONMENT_VARIABLE,
} from "../src/auth/owner-credential.js";
import { createHttpRequestHandler, type RequestGate } from "../src/http/handler.js";
import { createIngressPolicy } from "../src/http/ingress-policy.js";

interface HttpResult {
  body: string;
  statusCode: number;
}

interface HarnessOptions {
  authenticationError?: Error;
  authenticationResolver?: AuthenticationStateResolver;
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
    resolveAuthenticationState: (request) => {
      authenticationCalls += 1;
      if (options.authenticationError) {
        throw options.authenticationError;
      }
      if (options.authenticationResolver) {
        return options.authenticationResolver(request);
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
    request(path: string, method = "GET", headers?: OutgoingHttpHeaders): Promise<HttpResult> {
      return new Promise((resolve, reject) => {
        const outgoing = request(
          { headers, host: "127.0.0.1", method, path, port },
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

  it("integrates bearer verification with generic denial and MCP admission", async () => {
    const ownerToken = randomBytes(32).toString("base64url");
    const wrongToken = randomBytes(32).toString("base64url");
    const authenticationResolver = createOwnerAuthenticationResolver({
      [OWNER_TOKEN_ENVIRONMENT_VARIABLE]: ownerToken,
    });
    const harness = await startHarness({ authenticationResolver });

    const missing = await harness.request("/mcp", "POST");
    const invalid = await harness.request("/mcp", "POST", {
      authorization: `Bearer ${wrongToken}`,
    });
    const admitted = await harness.request("/mcp", "POST", {
      authorization: `Bearer ${ownerToken}`,
    });

    expect(missing).toEqual({ statusCode: 401, body: '{"error":"unauthorized"}' });
    expect(invalid).toEqual({ statusCode: 401, body: '{"error":"unauthorized"}' });
    expect(admitted).toEqual({ statusCode: 200, body: "mcp reached" });
    expect(harness.mcpCalls).toBe(1);
  });

  it("keeps the remote tunnel ingress allowlist ahead of bearer authentication", async () => {
    const ownerToken = randomBytes(32).toString("base64url");
    const wrongToken = randomBytes(32).toString("base64url");
    const authenticationResolver = createOwnerAuthenticationResolver({
      [OWNER_TOKEN_ENVIRONMENT_VARIABLE]: ownerToken,
    });
    const ingressPolicy = createIngressPolicy({
      mode: "remote-tunnel",
      publicHostname: "mcp.example.test",
    });
    const harness = await startHarness({
      authenticationResolver,
      ...ingressPolicy,
    });

    const invalid = await harness.request("/mcp", "POST", {
      authorization: `Bearer ${wrongToken}`,
      host: "mcp.example.test",
    });
    const admitted = await harness.request("/mcp", "POST", {
      authorization: `Bearer ${ownerToken}`,
      host: "mcp.example.test",
    });
    const spoofed = await harness.request("/mcp", "POST", {
      authorization: `Bearer ${ownerToken}`,
      host: "attacker.example",
      "x-forwarded-host": "mcp.example.test",
    });

    expect(invalid).toEqual({ statusCode: 401, body: '{"error":"unauthorized"}' });
    expect(admitted).toEqual({ statusCode: 200, body: "mcp reached" });
    expect(spoofed.statusCode).toBe(403);
    expect(harness.authenticationCalls).toBe(2);
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
