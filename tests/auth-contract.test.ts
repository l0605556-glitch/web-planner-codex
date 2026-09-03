import { describe, expect, it } from "vitest";

import {
  evaluateRemoteMcpAdmission,
  REMOTE_MCP_AUTH_CONTRACT,
  type OwnerAuthenticationState,
} from "../src/auth/contract.js";

describe("single-owner remote MCP authentication contract", () => {
  it.each<OwnerAuthenticationState>(["missing", "malformed", "invalid"])(
    "fails closed for %s authentication without leaking detail",
    (state) => {
      expect(evaluateRemoteMcpAdmission(state)).toEqual({
        admitted: false,
        statusCode: 401,
        publicError: "unauthorized",
      });
    },
  );

  it("admits only the authenticated owner to the existing read-only MCP surface", () => {
    expect(evaluateRemoteMcpAdmission("authenticated-owner")).toEqual({
      admitted: true,
      principal: "owner",
      capabilities: ["mcp:existing-read-only-tools"],
    });
  });

  it("does not grant execution or write authority", () => {
    expect(REMOTE_MCP_AUTH_CONTRACT).toMatchObject({
      principal: "owner",
      protectedSurface: "remote-mcp-entry",
      localBindDefault: "127.0.0.1",
      deniedAuthorities: [
        "command:execute",
        "filesystem:write",
        "git:write",
        "github:write",
      ],
    });
  });
});
