import { spawn } from "node:child_process";

interface CommandOptions {
  acceptedExitCodes?: readonly number[];
  maxBytes?: number;
  timeoutMs?: number;
}

export async function runReadOnlyCommand(
  command: string,
  args: readonly string[],
  cwd: string,
  options: CommandOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  const acceptedExitCodes = options.acceptedExitCodes ?? [0];
  const maxBytes = options.maxBytes ?? 256_000;
  const timeoutMs = options.timeoutMs ?? 10_000;

  return await new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let settled = false;

    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };

    const collect = (target: "stdout" | "stderr", chunk: Buffer): void => {
      outputBytes += chunk.byteLength;
      if (outputBytes > maxBytes) {
        child.kill();
        finish(() => reject(new Error(`Read-only command output exceeded ${maxBytes} bytes.`)));
        return;
      }
      if (target === "stdout") stdout += chunk.toString("utf8");
      else stderr += chunk.toString("utf8");
    };

    child.stdout.on("data", (chunk: Buffer) => collect("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => collect("stderr", chunk));
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (code) => {
      finish(() => {
        if (code === null || !acceptedExitCodes.includes(code)) {
          reject(new Error(`${command} exited with code ${String(code)}: ${stderr.trim()}`));
          return;
        }
        resolve({ stdout, stderr });
      });
    });

    const timer = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error(`${command} exceeded the ${timeoutMs}ms read-only timeout.`)));
    }, timeoutMs);
  });
}
