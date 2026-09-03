import { describe, expect, it } from "vitest";

import {
  loadRemoteConfiguration,
  PUBLIC_HOSTNAME_ENVIRONMENT_VARIABLE,
  REMOTE_CONFIGURATION_ERROR,
  RUNTIME_MODE_ENVIRONMENT_VARIABLE,
  SECURE_INGRESS_ENVIRONMENT_VARIABLE,
} from "../src/remote/config.js";

describe("remote tunnel configuration", () => {
  it("defaults to local mode", () => {
    expect(loadRemoteConfiguration({})).toEqual({ mode: "local" });
  });

  it("accepts explicit local mode without remote assertions", () => {
    expect(
      loadRemoteConfiguration({
        [RUNTIME_MODE_ENVIRONMENT_VARIABLE]: "local",
      }),
    ).toEqual({ mode: "local" });
  });

  it.each([
    {},
    { [SECURE_INGRESS_ENVIRONMENT_VARIABLE]: "1" },
    { [PUBLIC_HOSTNAME_ENVIRONMENT_VARIABLE]: "mcp.example.test" },
    {
      [SECURE_INGRESS_ENVIRONMENT_VARIABLE]: "true",
      [PUBLIC_HOSTNAME_ENVIRONMENT_VARIABLE]: "mcp.example.test",
    },
    {
      [SECURE_INGRESS_ENVIRONMENT_VARIABLE]: "1",
      [PUBLIC_HOSTNAME_ENVIRONMENT_VARIABLE]: "https://mcp.example.test",
    },
    {
      [SECURE_INGRESS_ENVIRONMENT_VARIABLE]: "1",
      [PUBLIC_HOSTNAME_ENVIRONMENT_VARIABLE]: "LOCALHOST",
    },
  ])("rejects incomplete or malformed remote mode", (remoteValues) => {
    expect(() =>
      loadRemoteConfiguration({
        [RUNTIME_MODE_ENVIRONMENT_VARIABLE]: "remote-tunnel",
        ...remoteValues,
      }),
    ).toThrow(REMOTE_CONFIGURATION_ERROR);
  });

  it("rejects unknown modes", () => {
    expect(() =>
      loadRemoteConfiguration({
        [RUNTIME_MODE_ENVIRONMENT_VARIABLE]: "public",
      }),
    ).toThrow(REMOTE_CONFIGURATION_ERROR);
  });

  it("accepts an explicitly asserted secure tunnel with an exact public hostname", () => {
    expect(
      loadRemoteConfiguration({
        [RUNTIME_MODE_ENVIRONMENT_VARIABLE]: "remote-tunnel",
        [SECURE_INGRESS_ENVIRONMENT_VARIABLE]: "1",
        [PUBLIC_HOSTNAME_ENVIRONMENT_VARIABLE]: "mcp.example.test",
      }),
    ).toEqual({ mode: "remote-tunnel", publicHostname: "mcp.example.test" });
  });
});
