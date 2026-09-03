import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { WorkspaceService } from "../src/workspace/service.js";

describe("WorkspaceService", () => {
  let root: string;
  let workspace: WorkspaceService;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "web-planner-codex-"));
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "example.ts"), "export const answer = 42;\n");
    await writeFile(path.join(root, ".env"), "SECRET=hidden\n");
    await writeFile(path.join(root, ".env.example"), "SECRET=placeholder\n");
    await writeFile(path.join(root, ".gitignore"), "ignored.txt\n");
    await writeFile(path.join(root, "ignored.txt"), "ignored\n");
    await mkdir(path.join(root, "node_modules"));
    await writeFile(path.join(root, "node_modules", "dependency.js"), "ignored\n");
    workspace = await WorkspaceService.create(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("lists visible files but omits ignored and sensitive files", async () => {
    const result = await workspace.listDirectory(".", 2, 100, 0);
    expect(result).toMatchObject({
      has_more: false,
      entries: expect.arrayContaining([
        { path: "workspace:/src", type: "directory" },
        { path: "workspace:/src/example.ts", type: "file" },
        { path: "workspace:/.env.example", type: "file" },
      ]),
    });
    expect(JSON.stringify(result)).not.toContain("ignored.txt");
    expect(JSON.stringify(result)).not.toContain("node_modules");
    expect(JSON.stringify(result)).not.toContain('workspace:/.env"');
  });

  it("reads bounded line ranges", async () => {
    const result = await workspace.readFile("src/example.ts", 1, 20);
    expect(result).toMatchObject({
      path: "workspace:/src/example.ts",
      start_line: 1,
      content: "1: export const answer = 42;\n2: ",
    });
  });

  it("rejects path traversal and sensitive files", async () => {
    await expect(workspace.readFile("../outside.txt", 1, 20)).rejects.toThrow();
    await expect(workspace.readFile(".env", 1, 20)).rejects.toThrow(/sensitive/i);
  });
});
