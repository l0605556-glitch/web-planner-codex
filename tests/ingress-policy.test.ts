import type { IncomingMessage, ServerResponse } from "node:http";

import { describe, expect, it, vi } from "vitest";

import { createIngressPolicy } from "../src/http/ingress-policy.js";

function request(headers: Record<string, string>): IncomingMessage {
  return { headers } as IncomingMessage;
}

function response(): ServerResponse {
  return {
    end: vi.fn(),
    writeHead: vi.fn().mockReturnThis(),
  } as unknown as ServerResponse;
}

describe("ingress policy", () => {
  it("keeps local mode limited to loopback Host and Origin", () => {
    const policy = createIngressPolicy({ mode: "local" });

    expect(policy.validateHost(request({ host: "127.0.0.1:43123" }), response())).toBe(true);
    expect(
      policy.validateOrigin(
        request({ host: "127.0.0.1:43123", origin: "http://localhost:43123" }),
        response(),
      ),
    ).toBe(true);
    expect(policy.validateHost(request({ host: "attacker.example" }), response())).toBe(false);
  });

  it("allows only loopback and the configured tunnel hostname in remote mode", () => {
    const policy = createIngressPolicy({
      mode: "remote-tunnel",
      publicHostname: "mcp.example.test",
    });

    expect(policy.validateHost(request({ host: "mcp.example.test" }), response())).toBe(true);
    expect(
      policy.validateOrigin(
        request({ host: "mcp.example.test", origin: "https://mcp.example.test" }),
        response(),
      ),
    ).toBe(true);
    expect(policy.validateHost(request({ host: "localhost:43123" }), response())).toBe(true);
    expect(policy.validateHost(request({ host: "attacker.example" }), response())).toBe(false);
  });

  it("does not trust forwarded host headers", () => {
    const policy = createIngressPolicy({
      mode: "remote-tunnel",
      publicHostname: "mcp.example.test",
    });

    expect(
      policy.validateHost(
        request({ host: "attacker.example", "x-forwarded-host": "mcp.example.test" }),
        response(),
      ),
    ).toBe(false);
  });
});
