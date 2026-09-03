import {
  hostHeaderValidation,
  localhostHostValidation,
  localhostOriginValidation,
  originValidation,
} from "@modelcontextprotocol/node";

import type { RemoteConfiguration } from "../remote/config.js";
import type { RequestGate } from "./handler.js";

export interface IngressPolicy {
  validateHost: RequestGate;
  validateOrigin: RequestGate;
}

const LOOPBACK_HOSTNAMES = ["localhost", "127.0.0.1", "[::1]"];

export function createIngressPolicy(configuration: RemoteConfiguration): IngressPolicy {
  if (configuration.mode === "local") {
    return {
      validateHost: localhostHostValidation(),
      validateOrigin: localhostOriginValidation(),
    };
  }

  const allowedHostnames = [...LOOPBACK_HOSTNAMES, configuration.publicHostname];
  return {
    validateHost: hostHeaderValidation(allowedHostnames),
    validateOrigin: originValidation(allowedHostnames),
  };
}
