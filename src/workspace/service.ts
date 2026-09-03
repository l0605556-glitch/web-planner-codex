import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { WorkspacePolicy } from "./policy.js";
import { runReadOnlyCommand } from "./process.js";

const MAX_FILE_BYTES = 1_000_000;
const MAX_LINE_COUNT = 400;

export interface DirectoryEntry {
  path: string;
  type: "directory" | "file";
}

export interface SearchMatch {
  path: string;
  line: number;
  text: string;
}

interface WorkspaceServiceOptions {
  trackedOnly?: boolean;
}

interface RipgrepMessage {
  type?: string;
  data?: {
    path?: { text?: string };
    lines?: { text?: string };
    line_number?: number;
  };
}

function workspaceUri(relativePath: string): string {
  return relativePath ? `workspace:/${relativePath}` : "workspace:/";
}

export class WorkspaceService {
  readonly policy: WorkspacePolicy;
  private readonly trackedOnly: boolean;
  private trackedPaths = new Set<string>();
  private trackedDirectories = new Set<string>();

  private constructor(policy: WorkspacePolicy, trackedOnly: boolean) {
    this.policy = policy;
    this.trackedOnly = trackedOnly;
  }

  static async create(root: string, options: WorkspaceServiceOptions = {}): Promise<WorkspaceService> {
    const service = new WorkspaceService(await WorkspacePolicy.create(root), options.trackedOnly ?? false);
    await service.refreshTrackedPaths();
    return service;
  }

  private async refreshTrackedPaths(): Promise<void> {
    if (!this.trackedOnly) return;
    const { stdout } = await runReadOnlyCommand("git", ["ls-files", "-z"], this.policy.root, { maxBytes: 500_000 });
    this.trackedPaths = new Set(stdout.split("\0").filter(Boolean).map((filePath) => filePath.replaceAll("\\", "/")));
    this.trackedDirectories = new Set([""]);
    for (const filePath of this.trackedPaths) {
      const segments = filePath.split("/");
      for (let index = 1; index < segments.length; index += 1) {
        this.trackedDirectories.add(segments.slice(0, index).join("/"));
      }
    }
  }

  private isAccessible(relativePath: string): boolean {
    const normalized = relativePath.replaceAll("\\", "/").replace(/^\.\//, "");
    if (!this.policy.isVisible(normalized)) return false;
    if (!this.trackedOnly || !normalized) return true;
    return this.trackedPaths.has(normalized) || this.trackedDirectories.has(normalized);
  }

  private assertAccessible(relativePath: string): void {
    if (!this.isAccessible(relativePath)) {
      throw new Error("The requested path is not available in the tracked read-only view.");
    }
  }

  async info(): Promise<Record<string, unknown>> {
    const entries = await this.listDirectory(".", 1, 50, 0);
    let gitRepository = false;
    try {
      await stat(path.join(this.policy.root, ".git"));
      gitRepository = true;
    } catch {
      gitRepository = false;
    }
    return {
      name: path.basename(this.policy.root),
      root: "workspace:/",
      fixed_workspace: true,
      git_repository: gitRepository,
      top_level_entries: entries.entries,
      safety: {
        access: "read-only",
        content_scope: this.trackedOnly ? "Git-tracked files only" : "visible workspace files",
        commands: "fixed read-only git and ripgrep invocations only",
        sensitive_files: "blocked",
      },
    };
  }

  async listDirectory(
    requestedPath: string,
    depth: number,
    limit: number,
    offset: number,
  ): Promise<Record<string, unknown>> {
    await this.refreshTrackedPaths();
    const resolved = await this.policy.resolveExisting(requestedPath);
    this.assertAccessible(resolved.relativePath);
    const targetStats = await stat(resolved.absolutePath);
    if (!targetStats.isDirectory()) {
      throw new Error("The requested path is not a directory.");
    }

    const collected: DirectoryEntry[] = [];
    const walk = async (absoluteDirectory: string, relativeDirectory: string, remainingDepth: number): Promise<void> => {
      const children = await readdir(absoluteDirectory, { withFileTypes: true });
      children.sort((left, right) => left.name.localeCompare(right.name));
      for (const child of children) {
        if (child.isSymbolicLink()) continue;
        const relativeChild = [relativeDirectory, child.name].filter(Boolean).join("/");
        if (!this.isAccessible(relativeChild)) continue;
        if (child.isDirectory()) {
          collected.push({ path: workspaceUri(relativeChild), type: "directory" });
          if (remainingDepth > 1) {
            await walk(path.join(absoluteDirectory, child.name), relativeChild, remainingDepth - 1);
          }
        } else if (child.isFile()) {
          collected.push({ path: workspaceUri(relativeChild), type: "file" });
        }
      }
    };

    await walk(resolved.absolutePath, resolved.relativePath, depth);
    const entries = collected.slice(offset, offset + limit);
    const nextOffset = offset + entries.length;
    return {
      path: workspaceUri(resolved.relativePath),
      count: entries.length,
      total_count: collected.length,
      offset,
      has_more: nextOffset < collected.length,
      ...(nextOffset < collected.length ? { next_offset: nextOffset } : {}),
      entries,
    };
  }

  async readFile(requestedPath: string, startLine: number, lineCount: number): Promise<Record<string, unknown>> {
    await this.refreshTrackedPaths();
    const resolved = await this.policy.resolveExisting(requestedPath);
    this.assertAccessible(resolved.relativePath);
    const targetStats = await stat(resolved.absolutePath);
    if (!targetStats.isFile()) {
      throw new Error("The requested path is not a regular file.");
    }
    if (targetStats.size > MAX_FILE_BYTES) {
      throw new Error(`The file exceeds the ${MAX_FILE_BYTES}-byte read limit.`);
    }

    const content = await readFile(resolved.absolutePath);
    if (content.includes(0)) {
      throw new Error("Binary files cannot be read through this bridge.");
    }
    const lines = content.toString("utf8").split(/\r?\n/);
    const firstIndex = Math.max(0, startLine - 1);
    const selected = lines.slice(firstIndex, firstIndex + Math.min(lineCount, MAX_LINE_COUNT));
    return {
      path: workspaceUri(resolved.relativePath),
      start_line: startLine,
      end_line: selected.length === 0 ? startLine - 1 : startLine + selected.length - 1,
      total_lines: lines.length,
      truncated: firstIndex + selected.length < lines.length,
      content: selected.map((line, index) => `${startLine + index}: ${line}`).join("\n"),
    };
  }

  async search(query: string, limit: number, offset: number): Promise<Record<string, unknown>> {
    await this.refreshTrackedPaths();
    const maxMatches = Math.min(200, offset + limit + 1);
    const args = [
      "--json",
      "--line-number",
      "--color",
      "never",
      "--max-count",
      String(maxMatches),
      "--glob",
      "!.git/**",
      "--glob",
      "!.web-planner-codex/**",
      "--glob",
      "!node_modules/**",
      "--glob",
      "!.env",
      "--glob",
      "!.env.*",
      "--glob",
      "!*.pem",
      "--glob",
      "!*.key",
      query,
      ".",
    ];
    const { stdout } = await runReadOnlyCommand("rg", args, this.policy.root, {
      acceptedExitCodes: [0, 1],
      maxBytes: 500_000,
    });

    const matches: SearchMatch[] = [];
    for (const line of stdout.split(/\r?\n/)) {
      if (!line) continue;
      let message: RipgrepMessage;
      try {
        message = JSON.parse(line) as RipgrepMessage;
      } catch {
        continue;
      }
      if (message.type !== "match") continue;
      const matchPath = message.data?.path?.text?.replaceAll("\\", "/");
      const matchLine = message.data?.line_number;
      const text = message.data?.lines?.text?.trimEnd();
      const relativeMatchPath = matchPath?.replace(/^\.\//, "");
      if (!relativeMatchPath || matchLine === undefined || text === undefined || !this.isAccessible(relativeMatchPath)) continue;
      matches.push({ path: workspaceUri(relativeMatchPath), line: matchLine, text });
    }

    const page = matches.slice(offset, offset + limit);
    return {
      query,
      count: page.length,
      offset,
      has_more: matches.length > offset + page.length,
      ...(matches.length > offset + page.length ? { next_offset: offset + page.length } : {}),
      matches: page,
    };
  }

  async gitStatus(): Promise<Record<string, unknown>> {
    const { stdout } = await runReadOnlyCommand(
      "git",
      ["status", "--short", "--branch", "--untracked-files=all"],
      this.policy.root,
    );
    const lines = stdout.trimEnd().split(/\r?\n/).filter(Boolean);
    const entries = lines.slice(1);
    if (this.trackedOnly) {
      return {
        branch: lines[0] ?? "",
        tracked_entries: entries.filter((entry) => !entry.startsWith("?? ")),
        untracked_count: entries.filter((entry) => entry.startsWith("?? ")).length,
        untracked_paths_included: false,
      };
    }
    return {
      branch: lines[0] ?? "",
      entries,
    };
  }

  async gitTrackedFiles(limit: number): Promise<Record<string, unknown>> {
    const { stdout } = await runReadOnlyCommand(
      "git",
      ["ls-files", "-z"],
      this.policy.root,
      { maxBytes: 500_000 },
    );
    const paths = stdout
      .split("\0")
      .filter(Boolean)
      .map((filePath) => filePath.replaceAll("\\", "/"))
      .filter((filePath) => this.policy.isVisible(filePath));
    return {
      count: Math.min(paths.length, limit),
      total_count: paths.length,
      truncated: paths.length > limit,
      paths: paths.slice(0, limit).map(workspaceUri),
    };
  }

  async gitDiff(
    mode: "unstaged" | "staged" | "all",
    requestedPath: string | undefined,
    contextLines: number,
  ): Promise<Record<string, unknown>> {
    let relativePath: string | undefined;
    if (requestedPath) {
      await this.refreshTrackedPaths();
      relativePath = (await this.policy.resolveExisting(requestedPath)).relativePath;
      this.assertAccessible(relativePath);
    }
    const makeArgs = (staged: boolean): string[] => [
      "diff",
      ...(staged ? ["--cached"] : []),
      "--no-ext-diff",
      `--unified=${contextLines}`,
      ...(relativePath ? ["--", relativePath] : []),
    ];
    const sections: string[] = [];
    if (mode === "unstaged" || mode === "all") {
      const { stdout } = await runReadOnlyCommand("git", makeArgs(false), this.policy.root, { maxBytes: 500_000 });
      if (stdout) sections.push(mode === "all" ? `# Unstaged\n${stdout}` : stdout);
    }
    if (mode === "staged" || mode === "all") {
      const { stdout } = await runReadOnlyCommand("git", makeArgs(true), this.policy.root, { maxBytes: 500_000 });
      if (stdout) sections.push(mode === "all" ? `# Staged\n${stdout}` : stdout);
    }
    return {
      mode,
      path: relativePath ? workspaceUri(relativePath) : "workspace:/",
      diff: sections.join("\n"),
      empty: sections.length === 0,
    };
  }
}
