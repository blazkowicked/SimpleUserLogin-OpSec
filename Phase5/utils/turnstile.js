// Cloudflare Turnstile check for the public forms (signup, login, forgot password, admin login).
// The widget in the browser only produces a token; this is the part that actually stops bots.
const getRealIp = require("./getRealIp");

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const VERIFY_TIMEOUT_MS = 5000;

// Cloudflare's published test keys: they always pass, so local dev works without an account
const TEST_SITE_KEY = "1x00000000000000000000AA";
const TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";

const isProduction = process.env.NODE_ENV === "production" || ["production", "preview"].includes(process.env.VERCEL_ENV);

function getKeys() {
  const siteKey = String(process.env.TURNSTILE_SITE_KEY || "").trim();
  const secretKey = String(process.env.TURNSTILE_SECRET_KEY || "").trim();
  if (siteKey && secretKey) return { siteKey, secretKey };
  // On Vercel, missing keys are a setup mistake: never fall back to keys that let everyone through
  if (isProduction) return null;
  return { siteKey: TEST_SITE_KEY, secretKey: TEST_SECRET_KEY };
}

if (!getKeys()) {
  console.error("[turnstile] TURNSTILE_SITE_KEY / TURNSTILE_SECRET_KEY not set. Signup, login, forgot password and admin login will be rejected until they are.");
} else if (!process.env.TURNSTILE_SECRET_KEY) {
  console.warn("[turnstile] No keys set, using Cloudflare's always-pass test keys (dev only).");
}

// Returns true only when Cloudflare confirms the token. Anything else, including Cloudflare
// being unreachable, counts as a failure (fail closed).
async function verifyToken(token, ip) {
  const keys = getKeys();
  if (!keys) return false;
  if (typeof token !== "string" || !token || token.length > 2048) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
  try {
    const form = new URLSearchParams({ secret: keys.secretKey, response: token });
    if (ip) form.set("remoteip", ip);
    const res = await fetch(VERIFY_URL, { method: "POST", body: form, signal: controller.signal });
    if (!res.ok) {
      console.error(`[turnstile] siteverify HTTP ${res.status}`);
      return false;
    }
    const data = await res.json();
    if (!data.success) console.warn("[turnstile] rejected:", (data["error-codes"] || []).join(", ") || "no reason given");
    return data.success === true;
  } catch (err) {
    console.error("[turnstile] could not reach Cloudflare:", err.name === "AbortError" ? "timed out" : err.message);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// Express middleware. Expects the widget's token as `turnstileToken` in the JSON body.
async function requireTurnstile(req, res, next) {
  const ok = await verifyToken(req.body?.turnstileToken, getRealIp(req));
  if (ok) return next();
  return res.status(400).json({ message: "Couldn't verify you're human. Please try the check again.", captcha: true });
}

// The site key is public; the browser needs it to draw the widget
function getSiteKey() {
  return getKeys()?.siteKey || null;
}

module.exports = { requireTurnstile, verifyToken, getSiteKey };
