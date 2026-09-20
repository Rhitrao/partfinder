// The passcode gate for /parts/vendors.
//
// There is one shared passcode, held as a Worker secret. A browser that types it correctly gets a
// cookie whose value is hex(HMAC-SHA256(key: VENDOR_PASSCODE, message: "partfinder-vendor-v1")).
//
// The cookie is derived from the passcode, not from a session record, for two reasons. There is no
// store to keep sessions in, and changing the passcode changes every valid cookie value, so every
// browser is signed out the moment `wrangler secret put VENDOR_PASSCODE` runs. Nothing about the
// passcode can be recovered from the cookie: the passcode is the HMAC key, and the message is a
// fixed string.
//
// The passcode itself, the cookie and the token are never logged.

import type { Env } from "../env";

export const COOKIE_NAME = "pf_vendor";

/** The HMAC message. A version string, so a future cookie format can be told apart from this one. */
const COOKIE_MESSAGE = "partfinder-vendor-v1";

/** 30 days. */
export const COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

/**
 * Path=/parts/ keeps the cookie off the rest of rohitrao.in. SameSite=Lax still sends it when the
 * user follows a link from the public page, which is how they arrive here.
 */
const COOKIE_ATTRIBUTES = "HttpOnly; Secure; SameSite=Lax; Path=/parts/";

const encoder = new TextEncoder();

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** hex(HMAC-SHA256(key: passcode, message: "partfinder-vendor-v1")): the cookie's value. */
export async function vendorToken(passcode: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passcode),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(COOKIE_MESSAGE)));
}

/**
 * Compare without leaking where two strings first differ. Both arguments here are always 64-char
 * hex digests, so the length check cannot leak anything about a passcode either.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * The submitted passcode's cookie value when it matches the secret, or null when it does not.
 *
 * The two passcodes are never compared directly. Each is turned into its fixed-length token first
 * and the tokens are compared in constant time, so neither the length nor any prefix of the real
 * passcode can be timed out of this. A missing secret matches nothing.
 */
export async function checkPasscode(submitted: string, env: Env): Promise<string | null> {
  if (env.VENDOR_PASSCODE === undefined || env.VENDOR_PASSCODE === "") return null;
  const expected = await vendorToken(env.VENDOR_PASSCODE);
  const given = await vendorToken(submitted);
  return constantTimeEqual(given, expected) ? expected : null;
}

/** One cookie's value from a Cookie header, or null. */
export function readCookie(header: string | null, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/** Whether this request carries a cookie made with the passcode that is current right now. */
export async function isSignedIn(request: Request, env: Env): Promise<boolean> {
  const value = readCookie(request.headers.get("Cookie"), COOKIE_NAME);
  if (value === null) return false;
  if (env.VENDOR_PASSCODE === undefined || env.VENDOR_PASSCODE === "") return false;
  return constantTimeEqual(value, await vendorToken(env.VENDOR_PASSCODE));
}

export function setCookie(token: string): string {
  return `${COOKIE_NAME}=${token}; ${COOKIE_ATTRIBUTES}; Max-Age=${COOKIE_MAX_AGE}`;
}

export function clearCookie(): string {
  return `${COOKIE_NAME}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`;
}
