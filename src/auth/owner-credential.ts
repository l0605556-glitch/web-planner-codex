import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

import type { AuthenticationStateResolver } from "./middleware.js";

export const OWNER_TOKEN_ENVIRONMENT_VARIABLE = "WEB_PLANNER_CODEX_OWNER_TOKEN";
export const OWNER_CREDENTIAL_CONFIGURATION_ERROR =
  "Owner authentication credential is missing or invalid.";

const MINIMUM_TOKEN_LENGTH = 43;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;
const BEARER_PATTERN = /^Bearer ([A-Za-z0-9_-]+)$/;

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function readAuthorizationValues(request: IncomingMessage): readonly string[] | undefined {
  return request.headersDistinct.authorization;
}

export function createOwnerAuthenticationResolver(
  environment: RuntimeEnvironment = process.env,
): AuthenticationStateResolver {
  const configuredToken = environment[OWNER_TOKEN_ENVIRONMENT_VARIABLE];
  if (
    configuredToken === undefined ||
    configuredToken.length < MINIMUM_TOKEN_LENGTH ||
    !TOKEN_PATTERN.test(configuredToken)
  ) {
    throw new Error(OWNER_CREDENTIAL_CONFIGURATION_ERROR);
  }

  const configuredDigest = digest(configuredToken);

  return (request) => {
    const authorizationValues = readAuthorizationValues(request);
    if (authorizationValues === undefined) {
      return "missing";
    }
    if (authorizationValues.length !== 1) {
      return "malformed";
    }

    const match = BEARER_PATTERN.exec(authorizationValues[0] ?? "");
    if (!match) {
      return "malformed";
    }

    const suppliedToken = match[1];
    if (!suppliedToken) {
      return "malformed";
    }

    return timingSafeEqual(digest(suppliedToken), configuredDigest)
      ? "authenticated-owner"
      : "invalid";
  };
}
