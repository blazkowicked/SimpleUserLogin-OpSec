const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const OtpChallenge = require("../models/OtpChallenge");
const { sendMail, buildUrl } = require("./mailer");

const CODE_TTL_MS = 10 * 60 * 1000;
const CHALLENGE_TTL_MS = 15 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_SENDS = 3;
// Slower than a typical send, so response time does not reveal whether an email went out
const MIN_RESPONSE_MS = 2500;

function deriveKey(label) {
  return crypto.createHmac("sha256", process.env.JWT_SECRET).update(label).digest("hex");
}

function hashCode(challengeId, code) {
  return crypto.createHmac("sha256", deriveKey("otp-code")).update(`${challengeId}:${code}`).digest("hex");
}

function maskEmail(email) {
  const [local, domain] = String(email).split("@");
  return `${local.slice(0, 2)}***@${domain}`;
}

function waitUntilPaced(startedAt) {
  const remaining = MIN_RESPONSE_MS - (Date.now() - startedAt);
  return remaining > 0 ? new Promise((resolve) => setTimeout(resolve, remaining)) : Promise.resolve();
}

// Signed with a derived key, so a pending token can never pass as a login JWT
function signPendingToken(challenge) {
  return jwt.sign({ cid: String(challenge._id), purpose: challenge.purpose }, deriveKey("otp-pending"), {
    algorithm: "HS256",
    expiresIn: Math.floor(CHALLENGE_TTL_MS / 1000),
  });
}

function verifyPendingToken(token, allowedPurposes) {
  if (typeof token !== "string") return null;
  try {
    const decoded = jwt.verify(token, deriveKey("otp-pending"), { algorithms: ["HS256"] });
    return allowedPurposes.includes(decoded.purpose) ? decoded : null;
  } catch (err) {
    return null;
  }
}

function pendingResponse(challenge) {
  return {
    otpRequired: true,
    pendingToken: signPendingToken(challenge),
    maskedEmail: maskEmail(challenge.email),
    message: "Check your email",
  };
}

// Sets a fresh hash on the challenge and returns the code. Decoys get a value no 6-digit code can match.
function rotateCode(challenge) {
  const isDecoy = challenge.delivery !== "code";
  const code = isDecoy ? null : String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  challenge.codeHash = hashCode(challenge._id, code || crypto.randomBytes(32).toString("hex"));
  challenge.codeExpiresAt = new Date(Date.now() + CODE_TTL_MS);
  return code;
}

async function deliver(challenge, code) {
  if (challenge.delivery === "none") return;
  if (challenge.delivery === "notice") {
    await sendMail({
      to: challenge.email,
      subject: "Someone tried to sign up with your email",
      text: `Someone tried to create an OpSec account using this email address, but you already have one.\n\nIf this was you, log in here: ${buildUrl("/LoginPage.html")}\nForgot your password? Reset it here: ${buildUrl("/ForgotPasswordPage.html")}\n\nIf this wasn't you, you can ignore this email. Your account has not been changed.`,
    });
    return;
  }
  await sendMail({
    to: challenge.email,
    subject: `${code} is your OpSec verification code`,
    text: `Your OpSec verification code is ${code}\n\nIt expires in 10 minutes. If you didn't request this, change your password and ignore this email.`,
  });
}

async function createChallenge({ purpose, email, subjectId = null, pendingPasswordHash = null, delivery = "code" }) {
  const challenge = new OtpChallenge({
    purpose,
    email,
    subjectId,
    pendingPasswordHash,
    delivery,
    lastSentAt: new Date(),
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
  });
  const code = rotateCode(challenge);
  await challenge.save();
  try {
    await deliver(challenge, code);
  } catch (err) {
    await challenge.deleteOne().catch(() => {});
    throw err;
  }
  return challenge;
}

async function resendChallenge(challengeId) {
  const now = Date.now();
  const challenge = await OtpChallenge.findOne({ _id: challengeId, expiresAt: { $gt: new Date(now) } });
  if (!challenge) return { status: "gone" };
  if (challenge.sendCount >= MAX_SENDS) return { status: "limit" };
  const waitMs = challenge.lastSentAt.getTime() + RESEND_COOLDOWN_MS - now;
  if (waitMs > 0) return { status: "cooldown", retryAfter: Math.ceil(waitMs / 1000) };

  const previous = { sendCount: challenge.sendCount, lastSentAt: challenge.lastSentAt };
  const code = rotateCode(challenge);
  const updated = await OtpChallenge.findOneAndUpdate(
    { _id: challengeId, ...previous },
    { $inc: { sendCount: 1 }, $set: { lastSentAt: new Date(now), codeHash: challenge.codeHash, codeExpiresAt: challenge.codeExpiresAt } },
    { new: true },
  );
  if (!updated) return { status: "cooldown", retryAfter: Math.ceil(RESEND_COOLDOWN_MS / 1000) };
  await deliver(updated, code);
  return { status: "sent", sendsLeft: MAX_SENDS - updated.sendCount };
}

// One live challenge per account, so repeat logins share the send, cooldown and attempt limits
async function startLoginChallenge({ purpose, email, subjectId }) {
  const existing = await OtpChallenge.findOne({ purpose, subjectId, expiresAt: { $gt: new Date() } });
  if (!existing) return createChallenge({ purpose, email, subjectId });
  await resendChallenge(existing._id);
  return existing;
}

async function verifyCode(challengeId, code) {
  const now = new Date();
  const challenge = await OtpChallenge.findOneAndUpdate(
    { _id: challengeId, attempts: { $lt: MAX_ATTEMPTS }, expiresAt: { $gt: now } },
    { $inc: { attempts: 1 } },
    { new: true },
  );
  if (!challenge) return { status: "gone" };
  if (challenge.codeExpiresAt <= now) return { status: "expired", challenge };

  const expected = Buffer.from(challenge.codeHash, "hex");
  const actual = Buffer.from(hashCode(challenge._id, code), "hex");
  if (!crypto.timingSafeEqual(expected, actual) || challenge.delivery !== "code") {
    if (challenge.attempts >= MAX_ATTEMPTS) {
      await OtpChallenge.deleteOne({ _id: challenge._id });
      return { status: "exhausted", challenge };
    }
    return { status: "invalid", challenge, attemptsLeft: MAX_ATTEMPTS - challenge.attempts };
  }

  const consumed = await OtpChallenge.findOneAndDelete({ _id: challenge._id });
  return consumed ? { status: "ok", challenge: consumed } : { status: "gone" };
}

function sendVerifyFailure(res, result) {
  if (result.status === "invalid") {
    return res.status(401).json({ message: `Incorrect code. ${result.attemptsLeft} attempt(s) left.`, attemptsLeft: result.attemptsLeft });
  }
  if (result.status === "expired") return res.status(401).json({ message: "This code has expired. Request a new one." });
  if (result.status === "exhausted") return res.status(429).json({ message: "Too many incorrect codes. Please start again.", restart: true });
  return res.status(401).json({ message: "This verification has expired. Please start again.", restart: true });
}

function sendResendResult(res, result) {
  if (result.status === "sent") return res.json({ sent: true, sendsLeft: result.sendsLeft });
  if (result.status === "cooldown") return res.status(429).json({ message: `Please wait ${result.retryAfter} seconds before resending.`, retryAfter: result.retryAfter });
  if (result.status === "limit") return res.status(429).json({ message: "No more resends left. Please start again.", restart: true });
  return res.status(401).json({ message: "This verification has expired. Please start again.", restart: true });
}

module.exports = {
  createChallenge,
  startLoginChallenge,
  resendChallenge,
  verifyCode,
  verifyPendingToken,
  pendingResponse,
  sendVerifyFailure,
  sendResendResult,
  waitUntilPaced,
};
