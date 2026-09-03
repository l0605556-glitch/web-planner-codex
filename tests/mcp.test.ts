import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildMcpServer } from "../src/mcp/server.js";
import { WorkspaceService } from "../src/workspace/service.js";

const execFileAsync = promisify(execFile);

describe("read-only MCP bridge", () => {
  let root: string;
  let handler: ReturnType<typeof createMcpHandler>;
  let client: Client;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "web-planner-codex-mcp-"));
    await writeFile(path.join(root, "project.txt"), "actual workspace content\n");
    await writeFile(path.join(root, "private-notes.txt"), "untracked private content\n");
    await execFileAsync("git", ["init", "--quiet"], { cwd: root });
    await execFileAsync("git", ["add", "project.txt"], { cwd: root });
    const workspace = await WorkspaceService.create(root, { trackedOnly: true });
    handler = createMcpHandler(() => buildMcpServer(workspace));
    const transport = new StreamableHTTPClientTransport(new URL("http://test.local/mcp"), {
      fetch: async (input, init) => await handler.fetch(new Request(input, init)),
    });
    client = new Client({ name: "web-planner-codex-test-client", version: "0.2.0" });
    await client.connect(transport);
  });

  afterEach(async () => {
    await client.close();
    await handler.close();
    await rm(root, { recursive: true, force: true });
  });

  it("exposes only the six intended read-only tools", async () => {
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      "planner_git_diff",
      "planner_git_status",
      "planner_list_directory",
      "planner_read_file",
      "planner_search_workspace",
      "planner_workspace_info",
    ]);
    for (const tool of tools.tools) {
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    }
  });

  it("reads a real file through the MCP protocol", async () => {
    const result = await client.callTool({
      name: "planner_read_file",
      arguments: { path: "project.txt", start_line: 1, line_count: 20 },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      path: "workspace:/project.txt",
      content: "1: actual workspace content\n2: ",
    });
  });

  it("rejects a sensitive file through the MCP protocol", async () => {
    await writeFile(path.join(root, ".env"), "SECRET=do-not-return\n");
    const result = await client.callTool({
      name: "planner_read_file",
      arguments: { path: ".env" },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain("do-not-return");
  });

  it("hides unrelated untracked files from listings and reads", async () => {
    const listing = await client.callTool({
      name: "planner_list_directory",
      arguments: { path: ".", depth: 1, limit: 100 },
    });
    expect(JSON.stringify(listing)).not.toContain("private-notes.txt");

    const read = await client.callTool({
      name: "planner_read_file",
      arguments: { path: "private-notes.txt" },
    });
    expect(read.isError).toBe(true);
    expect(JSON.stringify(read)).not.toContain("untracked private content");
  });
});
