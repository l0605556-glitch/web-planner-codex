import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";

import { OWNER_TOKEN_ENVIRONMENT_VARIABLE } from "../src/auth/owner-credential.js";
import {
  LOOPBACK_BIND_HOST,
  PUBLIC_HOSTNAME_ENVIRONMENT_VARIABLE,
  RUNTIME_MODE_ENVIRONMENT_VARIABLE,
  SECURE_INGRESS_ENVIRONMENT_VARIABLE,
} from "../src/remote/config.js";
import { createBridgeServer, type BridgeServer } from "../src/server.js";

const execFileAsync = promisify(execFile);
const EXPECTED_TOOLS = [
  "planner_git_diff",
  "planner_git_status",
  "planner_list_directory",
  "planner_read_file",
  "planner_search_workspace",
  "planner_workspace_info",
];

interface TestHarness {
  root: string;
  outsidePath: string;
  token: string;
  bridge: BridgeServer;
  connect: (token?: string, headers?: Record<string, string>) => Promise<Client>;
  close: () => Promise<void>;
}

async function startHarness(
  environmentOverrides: Readonly<Record<string, string>> = {},
): Promise<TestHarness> {
  const base = await mkdtemp(path.join(tmpdir(), "web-planner-codex-e2e-"));
  const root = path.join(base, "workspace");
  const outsidePath = path.join(base, "outside.txt");
  const token = randomBytes(32).toString("base64url");
  const clients: Client[] = [];

  await mkdir(root);
  await writeFile(path.join(root, "project.txt"), "actual tracked workspace content\n");
  await writeFile(path.join(root, "owner-secret.pem"), "tracked-sensitive-sentinel\n");
  await writeFile(path.join(root, "private-notes.txt"), "untracked-private-sentinel\n");
  await writeFile(outsidePath, "outside-traversal-sentinel\n");
  await execFileAsync("git", ["init", "--quiet"], { cwd: root });
  await execFileAsync("git", ["add", "project.txt", "owner-secret.pem"], { cwd: root });

  const bridge = await createBridgeServer(root, {
    [OWNER_TOKEN_ENVIRONMENT_VARIABLE]: token,
    ...environmentOverrides,
  });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    bridge.httpServer.once("error", onError);
    bridge.httpServer.listen(0, LOOPBACK_BIND_HOST, () => {
      bridge.httpServer.off("error", onError);
      resolve();
    });
  });

  const address = bridge.httpServer.address() as AddressInfo | null;
  if (!address || address.address !== LOOPBACK_BIND_HOST) {
    await bridge.close();
    await rm(base, { recursive: true, force: true });
    throw new Error("E2E server did not bind to the expected loopback address.");
  }
  const endpoint = new URL(`http://${LOOPBACK_BIND_HOST}:${address.port}/mcp`);

  return {
    root,
    outsidePath,
    token,
    bridge,
    connect: async (clientToken, headers = {}) => {
      const transport = new StreamableHTTPClientTransport(endpoint, {
        ...(clientToken === undefined
          ? {}
          : { authProvider: { token: async () => clientToken } }),
        requestInit: { headers },
      });
      const client = new Client({ name: "web-planner-codex-e2e-client", version: "0.2.0" });
      clients.push(client);
      await client.connect(transport);
      return client;
    },
    close: async () => {
      await Promise.allSettled(clients.reverse().map(async (client) => await client.close()));
      try {
        await bridge.close();
      } finally {
        await rm(base, { recursive: true, force: true });
      }
    },
  };
}

async function listToolNames(client: Client): Promise<string[]> {
  const result = await client.listTools();
  return result.tools.map((tool) => tool.name).sort();
}

describe("end-to-end owner permissions", () => {
  it("blocks missing and incorrect bearer credentials before MCP initialization", async () => {
    const harness = await startHarness();
    try {
      await expect(harness.connect()).rejects.toThrow();
      await expect(harness.connect(randomBytes(32).toString("base64url"))).rejects.toThrow();
    } finally {
      await harness.close();
    }
  });

  it("exposes exactly the six intended read-only tools to the authenticated owner", async () => {
    const harness = await startHarness();
    try {
      const client = await harness.connect(harness.token);
      const tools = await client.listTools();

      expect(tools.tools.map((tool) => tool.name).sort()).toEqual(EXPECTED_TOOLS);
      for (const tool of tools.tools) {
        expect(tool.annotations).toMatchObject({
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        });
      }
    } finally {
      await harness.close();
    }
  });

  it("reads a tracked normal file through the complete HTTP and MCP chain", async () => {
    const harness = await startHarness();
    try {
      const client = await harness.connect(harness.token);
      const result = await client.callTool({
        name: "planner_read_file",
        arguments: { path: "project.txt", start_line: 1, line_count: 20 },
      });

      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        path: "workspace:/project.txt",
        content: "1: actual tracked workspace content\n2: ",
      });
    } finally {
      await harness.close();
    }
  });

  it("keeps workspace denials in force after successful authentication", async () => {
    const harness = await startHarness();
    try {
      const client = await harness.connect(harness.token);
      const attempts = [
        { path: "owner-secret.pem", sentinel: "tracked-sensitive-sentinel" },
        { path: "private-notes.txt", sentinel: "untracked-private-sentinel" },
        { path: harness.outsidePath, sentinel: "outside-traversal-sentinel" },
        { path: "../outside.txt", sentinel: "outside-traversal-sentinel" },
      ];

      for (const attempt of attempts) {
        const result = await client.callTool({
          name: "planner_read_file",
          arguments: { path: attempt.path },
        });
        expect(result.isError).toBe(true);
        expect(JSON.stringify(result)).not.toContain(attempt.sentinel);
      }
    } finally {
      await harness.close();
    }
  });

  it("does not expand the tool surface in remote-tunnel mode", async () => {
    const publicHostname = "mcp.example.test";
    const harness = await startHarness({
      [RUNTIME_MODE_ENVIRONMENT_VARIABLE]: "remote-tunnel",
      [SECURE_INGRESS_ENVIRONMENT_VARIABLE]: "1",
      [PUBLIC_HOSTNAME_ENVIRONMENT_VARIABLE]: publicHostname,
    });
    try {
      const client = await harness.connect(harness.token, {
        Host: publicHostname,
        Origin: `https://${publicHostname}`,
      });
      expect(await listToolNames(client)).toEqual(EXPECTED_TOOLS);
      expect(harness.bridge.remoteConfiguration).toEqual({
        mode: "remote-tunnel",
        publicHostname,
      });
    } finally {
      await harness.close();
    }
  });
});
