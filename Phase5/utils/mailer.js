const nodemailer = require("nodemailer");

// VERCEL_ENV covers deployments where NODE_ENV is unset, so console mode can never fake a send there
const isProduction =
  process.env.NODE_ENV === "production" || ["production", "preview"].includes(process.env.VERCEL_ENV);

const REQUIRED_VARS = ["SMTP_USER", "SMTP_PASS", "MAIL_FROM"];
const missingVars = REQUIRED_VARS.filter((name) => !String(process.env[name] || "").trim());

if (isProduction && missingVars.length > 0) {
  console.warn(`[mailer] Email disabled — missing ${missingVars.join(", ")}. sendMail will fail; login is unaffected.`);
}

let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: process.env.SMTP_USER.trim(),
        pass: process.env.SMTP_PASS.replace(/\s+/g, ""),
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    });
  }
  return transporter;
}

// A value pasted with surrounding quotes (kept literally by Vercel) would otherwise parse as a name with no address
function getFrom() {
  return String(process.env.MAIL_FROM || "").trim().replace(/^"(.*)"$/, "$1");
}

function printToConsole({ from, to, replyTo, subject, text, html }) {
  const lines = ["", "========== [mailer] DEV EMAIL — NOT SENT ==========", `From:    ${from || "(MAIL_FROM not set)"}`, `To:      ${to}`, `Subject: ${subject}`];
  if (replyTo) lines.push(`Reply-To: ${replyTo}`);
  lines.push("--- text ---", text || "(none)");
  if (html) lines.push("--- html ---", html);
  lines.push("===================================================", "");
  console.log(lines.join("\n"));
}

// Resolves once the message is accepted (or printed, in dev). Rejects with a sanitized
// Error carrying only .code and .message, so callers can log it safely.
async function sendMail({ to, replyTo, subject, text, html }) {
  const from = getFrom();

  if (!isProduction) {
    printToConsole({ from, to, replyTo, subject, text, html });
    return { delivered: false };
  }

  if (missingVars.length > 0) {
    const error = new Error(`Email not configured: missing ${missingVars.join(", ")}`);
    error.code = "EMAILCONFIG";
    console.error(`[mailer] ${error.code}: ${error.message}`);
    throw error;
  }

  try {
    await getTransporter().sendMail({ from, to, replyTo, subject, text, html });
    return { delivered: true };
  } catch (err) {
    const code = err.code || "UNKNOWN";
    console.error(`[mailer] Send failed: ${code}: ${err.message}`);
    const error = new Error(`Email send failed (${code})`);
    error.code = code;
    throw error;
  }
}

// Builds an absolute link from APP_URL. Local-only fallback when APP_URL is unset in dev.
function buildUrl(path = "") {
  const base = String(process.env.APP_URL || "").trim().replace(/\/+$/, "");
  if (!base && isProduction) throw new Error("APP_URL is not set");
  const origin = base || `http://localhost:${process.env.PORT || 3000}`;
  return `${origin}/${String(path).replace(/^\/+/, "")}`;
}

module.exports = { sendMail, buildUrl };
