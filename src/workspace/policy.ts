import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

import ignore, { type Ignore } from "ignore";

const DEFAULT_IGNORES = [
  ".git/",
  ".web-planner-codex/",
  "node_modules/",
  "dist/",
  "coverage/",
];

const SENSITIVE_NAMES = new Set([
  "credentials.json",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_rsa",
  ".npmrc",
  ".pypirc",
]);

const SENSITIVE_EXTENSIONS = new Set([".key", ".p12", ".pfx", ".pem"]);

function toWorkspacePath(value: string): string {
  return value.split(path.sep).join("/");
}

async function addIgnoreFile(matcher: Ignore, filePath: string): Promise<void> {
  try {
    matcher.add(await readFile(filePath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

export class WorkspacePolicy {
  readonly root: string;
  private readonly matcher: Ignore;

  private constructor(root: string, matcher: Ignore) {
    this.root = root;
    this.matcher = matcher;
  }

  static async create(root: string): Promise<WorkspacePolicy> {
    const canonicalRoot = await realpath(path.resolve(root));
    const matcher = ignore().add(DEFAULT_IGNORES);
    await addIgnoreFile(matcher, path.join(canonicalRoot, ".gitignore"));
    await addIgnoreFile(matcher, path.join(canonicalRoot, ".web-planner-codexignore"));
    return new WorkspacePolicy(canonicalRoot, matcher);
  }

  isVisible(relativePath: string): boolean {
    const normalized = toWorkspacePath(relativePath).replace(/^\.\//, "");
    if (!normalized) {
      return true;
    }

    const segments = normalized.toLowerCase().split("/");
    const basename = segments.at(-1) ?? "";
    if (basename === ".env" || (basename.startsWith(".env.") && basename !== ".env.example")) {
      return false;
    }
    if (SENSITIVE_NAMES.has(basename) || SENSITIVE_EXTENSIONS.has(path.extname(basename))) {
      return false;
    }
    if (segments.includes(".git") || segments.includes(".web-planner-codex")) {
      return false;
    }
    return !this.matcher.ignores(normalized) && !this.matcher.ignores(`${normalized}/`);
  }

  async resolveExisting(requestedPath = "."): Promise<{ absolutePath: string; relativePath: string }> {
    const withoutScheme = requestedPath.replace(/^workspace:[\\/]/i, "");
    if (path.isAbsolute(withoutScheme)) {
      throw new Error("Absolute paths are not allowed. Use a workspace-relative path.");
    }

    const candidate = await realpath(path.resolve(this.root, withoutScheme || "."));
    const relativePath = path.relative(this.root, candidate);
    if (relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
      throw new Error("The requested path is outside the fixed workspace.");
    }
    if (!this.isVisible(relativePath)) {
      throw new Error("The requested path is ignored or contains sensitive information.");
    }
    return { absolutePath: candidate, relativePath: toWorkspacePath(relativePath) };
  }
}
