// Cloudflare Turnstile: the one thing standing between a bot and the Google allowance.
//
// The supplier list is public now, so nothing identifies who is asking. What the endpoint checks
// instead is that a browser did the asking: the page renders a Turnstile widget, the widget mints
// a token, and the token is spent here, once, against Cloudflare's siteverify.
//
// Nothing about a token is stored or logged, and TURNSTILE_SECRET_KEY never leaves this file.

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** One verification has this long. It is in the request path, so it cannot be generous. */
export const VERIFY_TIMEOUT_MS = 5000;

/** Turnstile's own documented ceiling. Anything longer was not minted by the widget. */
const MAX_TOKEN_LENGTH = 2048;

/**
 * Whether Cloudflare says this token is good. False for every other answer there is.
 *
 * A missing secret is a false, not a pass: a Worker deployed without TURNSTILE_SECRET_KEY can
 * verify nothing, and "cannot verify" must never mean "verified". Cloudflare's own error codes
 * are not read and not returned; the caller has one thing to say either way.
 */
export async function verifyTurnstile(
  secret: string | undefined,
  token: string,
  remoteIp: string | null,
): Promise<boolean> {
  const key = (secret ?? "").trim();
  if (key === "") return false;
  if (token === "" || token.length > MAX_TOKEN_LENGTH) return false;

  const form = new URLSearchParams({ secret: key, response: token });
  // Cloudflare sets CF-Connecting-IP itself, so this cannot be spoofed by a client header.
  if (remoteIp !== null && remoteIp !== "") form.set("remoteip", remoteIp);

  let response: Response;
  try {
    response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
  } catch {
    // A timeout or a dropped connection. Not logged, not shown, and not a pass.
    return false;
  }
  if (!response.ok) return false;
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return false;
  }
  if (typeof payload !== "object" || payload === null) return false;
  return (payload as { success?: unknown }).success === true;
}
