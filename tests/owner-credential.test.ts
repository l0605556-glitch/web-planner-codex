import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";

import { describe, expect, it } from "vitest";

import {
  createOwnerAuthenticationResolver,
  OWNER_CREDENTIAL_CONFIGURATION_ERROR,
  OWNER_TOKEN_ENVIRONMENT_VARIABLE,
} from "../src/auth/owner-credential.js";

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

function requestWithAuthorization(values?: readonly string[]): IncomingMessage {
  return {
    headersDistinct: values === undefined ? {} : { authorization: [...values] },
  } as IncomingMessage;
}

describe("owner credential configuration", () => {
  it.each([undefined, "", "   ", "too-short", `${"a".repeat(42)}!`])(
    "rejects missing or invalid runtime configuration",
    (configuredToken) => {
      expect(() =>
        createOwnerAuthenticationResolver({
          [OWNER_TOKEN_ENVIRONMENT_VARIABLE]: configuredToken,
        }),
      ).toThrow(OWNER_CREDENTIAL_CONFIGURATION_ERROR);
    },
  );

  it("does not expose an invalid configured value in its error", () => {
    const invalidValue = `${randomToken()}!`;

    expect(() =>
      createOwnerAuthenticationResolver({
        [OWNER_TOKEN_ENVIRONMENT_VARIABLE]: invalidValue,
      }),
    ).toThrow(OWNER_CREDENTIAL_CONFIGURATION_ERROR);

    try {
      createOwnerAuthenticationResolver({
        [OWNER_TOKEN_ENVIRONMENT_VARIABLE]: invalidValue,
      });
    } catch (error) {
      expect(String(error)).not.toContain(invalidValue);
    }
  });
});

describe("owner bearer credential resolver", () => {
  it.each([
    { values: undefined, expected: "missing" },
    { values: [], expected: "malformed" },
    { values: [""], expected: "malformed" },
    { values: ["Basic abc"], expected: "malformed" },
    { values: ["Bearer"], expected: "malformed" },
    { values: ["Bearer one two"], expected: "malformed" },
    { values: ["Bearer one", "Bearer two"], expected: "malformed" },
  ] as const)("maps strict header input to $expected", ({ values, expected }) => {
    const resolver = createOwnerAuthenticationResolver({
      [OWNER_TOKEN_ENVIRONMENT_VARIABLE]: randomToken(),
    });

    expect(resolver(requestWithAuthorization(values))).toBe(expected);
  });

  it("accepts only the configured token", () => {
    const configuredToken = randomToken();
    const resolver = createOwnerAuthenticationResolver({
      [OWNER_TOKEN_ENVIRONMENT_VARIABLE]: configuredToken,
    });

    expect(resolver(requestWithAuthorization([`Bearer ${configuredToken}`]))).toBe(
      "authenticated-owner",
    );
    expect(resolver(requestWithAuthorization([`Bearer ${randomToken()}`]))).toBe("invalid");
    expect(resolver(requestWithAuthorization(["Bearer different-length-token"]))).toBe("invalid");
  });
});
