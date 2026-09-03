export const REMOTE_MCP_AUTH_CONTRACT = {
  principal: "owner",
  protectedSurface: "remote-mcp-entry",
  localBindDefault: "127.0.0.1",
  grantedCapabilities: ["mcp:existing-read-only-tools"],
  deniedAuthorities: [
    "command:execute",
    "filesystem:write",
    "git:write",
    "github:write",
  ],
} as const;

export type OwnerAuthenticationState = "missing" | "malformed" | "invalid" | "authenticated-owner";

export type RemoteMcpAdmission =
  | {
      admitted: false;
      statusCode: 401;
      publicError: "unauthorized";
    }
  | {
      admitted: true;
      principal: "owner";
      capabilities: typeof REMOTE_MCP_AUTH_CONTRACT.grantedCapabilities;
    };

export function evaluateRemoteMcpAdmission(state: OwnerAuthenticationState): RemoteMcpAdmission {
  if (state !== "authenticated-owner") {
    return { admitted: false, statusCode: 401, publicError: "unauthorized" };
  }

  return {
    admitted: true,
    principal: REMOTE_MCP_AUTH_CONTRACT.principal,
    capabilities: REMOTE_MCP_AUTH_CONTRACT.grantedCapabilities,
  };
}
