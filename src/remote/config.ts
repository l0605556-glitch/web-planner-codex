export const RUNTIME_MODE_ENVIRONMENT_VARIABLE = "WEB_PLANNER_CODEX_MODE";
export const SECURE_INGRESS_ENVIRONMENT_VARIABLE = "WEB_PLANNER_CODEX_SECURE_INGRESS";
export const PUBLIC_HOSTNAME_ENVIRONMENT_VARIABLE = "WEB_PLANNER_CODEX_PUBLIC_HOSTNAME";
export const REMOTE_CONFIGURATION_ERROR = "Remote tunnel configuration is missing or invalid.";
export const LOOPBACK_BIND_HOST = "127.0.0.1";

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export type RemoteConfiguration =
  | { mode: "local" }
  | { mode: "remote-tunnel"; publicHostname: string };

function normalizePublicHostname(value: string | undefined): string | undefined {
  if (!value) return undefined;

  const normalized = value.toLowerCase();
  if (normalized !== value || !normalized.includes(".")) return undefined;

  try {
    const parsed = new URL(`https://${normalized}`);
    if (
      parsed.hostname !== normalized ||
      parsed.port ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      return undefined;
    }
  } catch {
    return undefined;
  }

  return normalized;
}

export function loadRemoteConfiguration(
  environment: RuntimeEnvironment = process.env,
): RemoteConfiguration {
  const mode = environment[RUNTIME_MODE_ENVIRONMENT_VARIABLE] ?? "local";
  if (mode === "local") {
    return { mode };
  }
  if (mode !== "remote-tunnel") {
    throw new Error(REMOTE_CONFIGURATION_ERROR);
  }

  const publicHostname = normalizePublicHostname(
    environment[PUBLIC_HOSTNAME_ENVIRONMENT_VARIABLE],
  );
  if (environment[SECURE_INGRESS_ENVIRONMENT_VARIABLE] !== "1" || !publicHostname) {
    throw new Error(REMOTE_CONFIGURATION_ERROR);
  }

  return { mode, publicHostname };
}
