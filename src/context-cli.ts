#!/usr/bin/env node

import path from "node:path";

import { WorkspaceService } from "./workspace/service.js";

type Action = "overview" | "read-file" | "search" | "git-diff";

interface Options {
  action: Action;
  workspace: string;
  path?: string;
  query?: string;
  startLine: number;
  lineCount: number;
  limit: number;
}

function requireValue(args: readonly string[], index: number, name: string): string {
  const value = args[index + 1];
  if (!value) throw new Error(`${name} requires a value.`);
  return value;
}

function parsePositiveInteger(value: string, name: string, maximum: number): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > maximum) {
    throw new Error(`${name} requires an integer between 1 and ${maximum}.`);
  }
  return number;
}

function parseOptions(args: readonly string[]): Options {
  const options: Options = {
    action: "overview",
    workspace: process.cwd(),
    startLine: 1,
    lineCount: 200,
    limit: 50,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--workspace") {
      options.workspace = requireValue(args, index, argument);
      index += 1;
    } else if (argument === "--action") {
      const value = requireValue(args, index, argument);
      if (!["overview", "read-file", "search", "git-diff"].includes(value)) {
        throw new Error("--action must be overview, read-file, search, or git-diff.");
      }
      options.action = value as Action;
      index += 1;
    } else if (argument === "--path") {
      options.path = requireValue(args, index, argument);
      index += 1;
    } else if (argument === "--query") {
      options.query = requireValue(args, index, argument);
      index += 1;
    } else if (argument === "--start-line") {
      options.startLine = parsePositiveInteger(requireValue(args, index, argument), argument, 1_000_000);
      index += 1;
    } else if (argument === "--line-count") {
      options.lineCount = parsePositiveInteger(requireValue(args, index, argument), argument, 400);
      index += 1;
    } else if (argument === "--limit") {
      options.limit = parsePositiveInteger(requireValue(args, index, argument), argument, 100);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${String(argument)}`);
    }
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const workspace = await WorkspaceService.create(path.resolve(options.workspace));
  let result: Record<string, unknown>;

  if (options.action === "overview") {
    const [info, trackedFiles, status] = await Promise.all([
      workspace.info(),
      workspace.gitTrackedFiles(200),
      workspace.gitStatus(),
    ]);
    const { top_level_entries: _topLevelEntries, ...safeInfo } = info;
    const entries = Array.isArray(status.entries) ? status.entries.filter((entry): entry is string => typeof entry === "string") : [];
    const untrackedCount = entries.filter((entry) => entry.startsWith("?? ")).length;
    result = {
      info: safeInfo,
      context_packet_scope: "Git-tracked paths only; untracked paths are excluded by default",
      tracked_files: trackedFiles,
      git_status: {
        branch: status.branch,
        tracked_changes: entries.filter((entry) => !entry.startsWith("?? ")),
        untracked_count: untrackedCount,
        untracked_paths_included: false,
      },
    };
  } else if (options.action === "read-file") {
    if (!options.path) throw new Error("--path is required for read-file.");
    result = await workspace.readFile(options.path, options.startLine, options.lineCount);
  } else if (options.action === "search") {
    if (!options.query) throw new Error("--query is required for search.");
    result = await workspace.search(options.query, options.limit, 0);
  } else {
    result = await workspace.gitDiff("all", options.path, 3);
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
