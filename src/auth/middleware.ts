import type { IncomingMessage, ServerResponse } from "node:http";

import {
  evaluateRemoteMcpAdmission,
  type OwnerAuthenticationState,
} from "./contract.js";

export type AuthenticationStateResolver = (request: IncomingMessage) => OwnerAuthenticationState;

export function enforceOwnerAuthentication(
  request: IncomingMessage,
  response: ServerResponse,
  resolveAuthenticationState: AuthenticationStateResolver,
): boolean {
  let authenticationState: OwnerAuthenticationState;

  try {
    authenticationState = resolveAuthenticationState(request);
  } catch {
    authenticationState = "invalid";
  }

  const admission = evaluateRemoteMcpAdmission(authenticationState);
  if (!admission.admitted) {
    response.writeHead(admission.statusCode, {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify({ error: admission.publicError }));
    return false;
  }

  return true;
}
