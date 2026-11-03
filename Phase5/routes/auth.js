const crypto = require("crypto");
const express = require("express");
const { body, validationResult } = require("express-validator");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = require("../models/User");
const AuditLog = require("../models/AuditLog");
const OtpChallenge = require("../models/OtpChallenge");
const PasswordReset = require("../models/PasswordReset");
const Session = require("../models/Session");
const Admin = require("../models/Admin");
const auth = require("../middleware/auth");
const createRateLimiter = require("../middleware/rateLimiter");
const getRealIp = require("../utils/getRealIp");
const { sendMail, buildUrl } = require("../utils/mailer");
const otp = require("../utils/otp");
const { startSession } = require("../utils/session");
const { passwordField } = require("../utils/passwordPolicy");

const router = express.Router();

const SALT_ROUNDS = 10;
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("dummy-password-for-timing", SALT_ROUNDS);
const LOCK_DURATION_MS = 24 * 60 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const MAX_SIGNUP_EMAILS_PER_ADDRESS = 3;
const RESET_TTL_MS = 20 * 60 * 1000;

const authLoginIeLimiter = createRateLimiter({
  scope: "auth_login_ie",
  windowMs: 15 * 60 * 1000,
  max: 50,
  keyFn: (req) => {
    const ip = getRealIp(req);
    const email = (req.body?.email || "").toLowerCase().trim();
    return email ? `ip:${ip}:email:${email}` : `ip:${ip}`;
  },
  message: "Too many requests, please try again later.",
});

const authLoginIpLimiter = createRateLimiter({
  scope: "auth_login_ip",
  windowMs: 15 * 60 * 1000,
  max: 150,
  keyFn: (req) => `ip:${getRealIp(req)}`,
  message: "Too many requests, please try again later.",
});

const authSignupIpLimiter = createRateLimiter({
  scope: "auth_signup_ip",
  windowMs: 60 * 60 * 1000,
  max: 25,
  keyFn: (req) => `ip:${getRealIp(req)}`,
  message: "Too many requests, please try again later.",
});

const otpVerifyLimiter = createRateLimiter({
  scope: "auth_otp_verify",
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyFn: (req) => `ip:${getRealIp(req)}`,
  message: "Too many requests, please try again later.",
});

const otpResendLimiter = createRateLimiter({
  scope: "auth_otp_resend",
  windowMs: 15 * 60 * 1000,
  max: 15,
  keyFn: (req) => `ip:${getRealIp(req)}`,
  message: "Too many requests, please try again later.",
});

const forgotIpLimiter = createRateLimiter({
  scope: "auth_forgot_ip",
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyFn: (req) => `ip:${getRealIp(req)}`,
  message: "Too many requests, please try again later.",
});

const forgotEmailLimiter = createRateLimiter({
  scope: "auth_forgot_email",
  windowMs: 15 * 60 * 1000,
  max: 3,
  keyFn: (req) => `email:${String(req.body?.email || "").toLowerCase().trim()}`,
  message: "Too many requests, please try again later.",
});

const resetIpLimiter = createRateLimiter({
  scope: "auth_reset_ip",
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyFn: (req) => `ip:${getRealIp(req)}`,
  message: "Too many requests, please try again later.",
});

const forceChangeLimiter = createRateLimiter({
  scope: "auth_force_change",
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyFn: (req) => `ip:${getRealIp(req)}`,
  message: "Too many requests, please try again later.",
});

const changePasswordLimiter = createRateLimiter({
  scope: "auth_change_password",
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyFn: (req) => `user:${req.user?.id}`,
  message: "Too many attempts, please try again later.",
});

const contactLimiter = createRateLimiter({
  scope: "auth_contact",
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyFn: (req) => `user:${req.user?.id}`,
  message: "You've sent several requests already. Please wait for an admin to reply.",
});

const passwordRules = () => passwordField("password");

// Awaited, unlike the older fire-and-forget writes: Vercel can kill work left running after the response
function audit(email, action, actor) {
  return AuditLog.create({ email, action, actor }).catch((err) => console.error(`[audit ${action}]`, err));
}

function hashResetToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function isDBReady(res) {
  if (mongoose.connection.readyState !== 1) {
    res.status(503).json({
      message: "Database not connected. Set real MONGODB_URI in Phase5/.env and restart server.",
    });
    return false;
  }
  return true;
}

// POST /api/auth/signup
router.post(
  "/signup",
  authSignupIpLimiter,
  [
    body("email").trim().isEmail().withMessage("Valid email required").isLength({ max: 254 }),
    passwordRules(),
    // The checkbox alone can be skipped by calling the API directly
    body("acceptedPrivacy")
      .custom((value) => value === true)
      .withMessage("Please confirm you've read the privacy policy"),
  ],
  async (req, res) => {
    if (!isDBReady(res)) return;
    const startedAt = Date.now();
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ message: errors.array()[0].msg, errors: errors.array() });

    const { email, password, confirmPassword } = req.body;
    if (confirmPassword !== undefined && password !== confirmPassword) {
      return res.status(400).json({ message: "Passwords do not match" });
    }
    try {
      const normalized = email.toLowerCase().trim();
      const [existing, recentAttempts, passwordHash] = await Promise.all([
        User.exists({ email: normalized }),
        OtpChallenge.countDocuments({ purpose: "signup", email: normalized }),
        bcrypt.hash(password, SALT_ROUNDS),
      ]);

      // Each attempt gets its own challenge, so a code can only ever confirm the password it was requested with.
      // Registered addresses get a decoy: same response, a notice instead of a code, and it can never verify.
      let delivery = existing ? "notice" : "code";
      if (recentAttempts >= MAX_SIGNUP_EMAILS_PER_ADDRESS) delivery = "none";

      const challenge = await otp.createChallenge({
        purpose: "signup",
        email: normalized,
        pendingPasswordHash: existing ? null : passwordHash,
        delivery,
      });
      await audit(normalized, existing ? "signup_existing_email" : "otp_sent", null);
      await otp.waitUntilPaced(startedAt);
      return res.status(202).json(otp.pendingResponse(challenge));
    } catch (err) {
      console.error("[signup]", err.code, err.message);
      await otp.waitUntilPaced(startedAt);
      return res.status(502).json({ message: "We couldn't send your verification email. Please try again." });
    }
  },
);

// POST /api/auth/login
router.post(
  "/login",
  authLoginIeLimiter,
  authLoginIpLimiter,
  [body("email").trim().isEmail().withMessage("Valid email required"), body("password").notEmpty().withMessage("Password is required")],
  async (req, res) => {
    if (!isDBReady(res)) return;
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(401).json({ message: "Invalid credentials" });

    const { email, password } = req.body;
    const normalized = (email || "").toLowerCase().trim();
    try {
      const user = await User.findOne({ email: normalized });
      if (!user) {
        await bcrypt.compare(password || "", DUMMY_PASSWORD_HASH);
        AuditLog.create({ email: normalized, action: "login_failure", actor: null }).catch((err) => console.error("[audit login_failure]", err));
        return res.status(401).json({ message: "Invalid credentials" });
      }

      const now = new Date();
      if (user.lockUntil && user.lockUntil <= now) {
        user.lockUntil = null;
        user.failedLoginAttempts = 0;
        user.isLocked = false;
        await user.save();
      }

      if (user.lockUntil && user.lockUntil > now) {
        await bcrypt.compare(password || "", DUMMY_PASSWORD_HASH);
        AuditLog.create({ email: normalized, action: "login_failure", actor: null }).catch((err) => console.error("[audit login_failure]", err));
        return res.status(401).json({ message: "Invalid credentials" });
      }

      const match = await bcrypt.compare(password || "", user.passwordHash);
      if (!match) {
        user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
        if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
          user.lockUntil = new Date(Date.now() + LOCK_DURATION_MS);
          user.isLocked = true;
          AuditLog.create({ email: normalized, action: "account_locked", actor: null }).catch((err) => console.error("[audit account_locked]", err));
        }
        await user.save();
        AuditLog.create({ email: normalized, action: "login_failure", actor: null }).catch((err) => console.error("[audit login_failure]", err));
        return res.status(401).json({ message: "Invalid credentials" });
      }

      // Lock counters are cleared in /verify-otp, so a stolen password alone cannot reset them
      try {
        const challenge = await otp.startLoginChallenge({ purpose: "login", email: user.email, subjectId: user._id });
        await audit(user.email, "otp_sent", null);
        return res.json(otp.pendingResponse(challenge));
      } catch (err) {
        console.error("[login otp]", err.code, err.message);
        return res.status(502).json({ message: "We couldn't send your verification code. Please try again." });
      }
    } catch (err) {
      console.error("[login]", err);
      try {
        await bcrypt.compare(password || "", DUMMY_PASSWORD_HASH);
      } catch (_) {}
      return res.status(401).json({ message: "Invalid credentials" });
    }
  },
);

async function completeSignup(challenge, req, res) {
  try {
    const user = await User.create({ email: challenge.email, passwordHash: challenge.pendingPasswordHash, emailVerified: true });
    await audit(user.email, "signup", user.email);
    const token = await startSession(user, req);
    return res.status(201).json({ token, user: { id: user._id, email: user.email } });
  } catch (err) {
    if (err.code !== 11000) console.error("[signup verify]", err);
    return res.status(401).json({ message: "This verification has expired. Please start again.", restart: true });
  }
}

async function completeLogin(challenge, req, res) {
  const user = await User.findById(challenge.subjectId);
  if (!user || (user.lockUntil && user.lockUntil > new Date())) {
    return res.status(401).json({ message: "This verification has expired. Please start again.", restart: true });
  }
  user.failedLoginAttempts = 0;
  user.lockUntil = null;
  user.isLocked = false;
  user.emailVerified = true;
  await user.save();
  if (user.mustChangePassword) {
    return res.json({ passwordChangeRequired: true, changeToken: otp.signPasswordChangeToken(user) });
  }
  await audit(user.email, "login_success", user.email);
  const token = await startSession(user, req);
  return res.json({ token, user: { id: user._id, email: user.email } });
}

// Five wrong codes count as one failed login, so repeated logins cannot keep guessing
async function recordOtpExhausted(challenge) {
  const user = await User.findById(challenge.subjectId);
  if (!user) return;
  user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
  if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
    user.lockUntil = new Date(Date.now() + LOCK_DURATION_MS);
    user.isLocked = true;
    await audit(user.email, "account_locked", null);
  }
  await user.save();
}

// POST /api/auth/verify-otp
router.post("/verify-otp", otpVerifyLimiter, [body("code").isString().matches(/^\d{6}$/)], async (req, res) => {
  if (!isDBReady(res)) return;
  const pending = otp.verifyPendingToken(req.body.pendingToken, ["signup", "login"]);
  if (!pending) return res.status(401).json({ message: "This verification has expired. Please start again.", restart: true });
  if (!validationResult(req).isEmpty()) return res.status(400).json({ message: "Enter the 6-digit code" });

  try {
    const result = await otp.verifyCode(pending.cid, req.body.code);
    if (result.status === "ok") {
      return result.challenge.purpose === "signup" ? await completeSignup(result.challenge, req, res) : await completeLogin(result.challenge, req, res);
    }
    if (result.challenge) await audit(result.challenge.email, result.status === "exhausted" ? "otp_exhausted" : "otp_failed", null);
    if (result.status === "exhausted" && result.challenge.purpose === "login") await recordOtpExhausted(result.challenge);
    return otp.sendVerifyFailure(res, result);
  } catch (err) {
    console.error("[verify otp]", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// POST /api/auth/resend-otp
router.post("/resend-otp", otpResendLimiter, async (req, res) => {
  if (!isDBReady(res)) return;
  const startedAt = Date.now();
  const pending = otp.verifyPendingToken(req.body.pendingToken, ["signup", "login"]);
  if (!pending) return res.status(401).json({ message: "This verification has expired. Please start again.", restart: true });
  try {
    const result = await otp.resendChallenge(pending.cid);
    await otp.waitUntilPaced(startedAt);
    return otp.sendResendResult(res, result);
  } catch (err) {
    console.error("[resend otp]", err.code, err.message);
    await otp.waitUntilPaced(startedAt);
    return res.status(502).json({ message: "We couldn't send your verification code. Please try again." });
  }
});

// POST /api/auth/forgot-password — same response whether or not the email exists
router.post("/forgot-password", forgotIpLimiter, forgotEmailLimiter, [body("email").trim().isEmail()], async (req, res) => {
  if (!isDBReady(res)) return;
  const startedAt = Date.now();
  try {
    if (validationResult(req).isEmpty()) {
      const normalized = String(req.body.email).toLowerCase().trim();
      await audit(normalized, "password_reset_requested", null);
      const user = await User.findOne({ email: normalized });
      if (user) {
        const token = crypto.randomBytes(32).toString("hex");
        await PasswordReset.deleteMany({ userId: user._id });
        await PasswordReset.create({ userId: user._id, tokenHash: hashResetToken(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) });
        // The token stays in the URL fragment, which is never sent to servers or in Referer headers
        await sendMail({
          to: user.email,
          subject: "Reset your OpSec password",
          text: `Use this link to reset your OpSec password. It expires in 20 minutes and can only be used once:\n\n${buildUrl(`/ResetPasswordPage.html#token=${token}`)}\n\nIf you didn't request this, you can ignore this email.`,
        });
      }
    }
  } catch (err) {
    console.error("[forgot password]", err.code, err.message);
  }
  await otp.waitUntilPaced(startedAt);
  return res.json({ message: "If that email has an account, a reset link is on its way." });
});

// POST /api/auth/reset-password
router.post("/reset-password", resetIpLimiter, [passwordRules()], async (req, res) => {
  if (!isDBReady(res)) return;
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ message: errors.array()[0].msg });

  const { token, password, confirmPassword } = req.body;
  if (typeof token !== "string" || !token) return res.status(400).json({ message: "This reset link is invalid or has expired." });
  if (confirmPassword !== undefined && password !== confirmPassword) {
    return res.status(400).json({ message: "Passwords do not match" });
  }
  try {
    const now = new Date();
    const reset = await PasswordReset.findOneAndUpdate(
      { tokenHash: hashResetToken(token), usedAt: null, expiresAt: { $gt: now } },
      { $set: { usedAt: now } },
    );
    const user = reset && (await User.findById(reset.userId));
    if (!user) return res.status(400).json({ message: "This reset link is invalid or has expired." });

    user.passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    user.failedLoginAttempts = 0;
    user.lockUntil = null;
    user.isLocked = false;
    user.emailVerified = true;
    user.mustChangePassword = false;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

    await Promise.all([
      PasswordReset.deleteMany({ userId: user._id }),
      OtpChallenge.deleteMany({ purpose: "login", subjectId: user._id }),
      Session.deleteMany({ userId: user._id }),
    ]);
    await audit(user.email, "password_reset_completed", user.email);
    return res.json({ message: "Password updated. You can now log in." });
  } catch (err) {
    console.error("[reset password]", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// POST /api/auth/force-change-password — after a temporary password and a verified code
router.post("/force-change-password", forceChangeLimiter, [passwordRules()], async (req, res) => {
  if (!isDBReady(res)) return;
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ message: errors.array()[0].msg });

  const expired = { message: "This session has expired. Please log in again.", restart: true };
  const pending = otp.verifyPasswordChangeToken(req.body.changeToken);
  if (!pending) return res.status(401).json(expired);

  const { password, confirmPassword } = req.body;
  if (confirmPassword !== undefined && password !== confirmPassword) {
    return res.status(400).json({ message: "Passwords do not match" });
  }
  try {
    const user = await User.findById(pending.uid);
    if (!user || !user.mustChangePassword || (user.tokenVersion || 0) !== pending.tv) return res.status(401).json(expired);
    if (user.lockUntil && user.lockUntil > new Date()) return res.status(401).json(expired);
    if (await bcrypt.compare(password, user.passwordHash)) {
      return res.status(400).json({ message: "Choose a password different from your temporary one" });
    }

    user.passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    user.mustChangePassword = false;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

    await audit(user.email, "forced_password_change_completed", user.email);
    await audit(user.email, "login_success", user.email);
    await Session.deleteMany({ userId: user._id });
    const token = await startSession(user, req);
    return res.json({ token, user: { id: user._id, email: user.email } });
  } catch (err) {
    console.error("[force change]", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// GET /api/auth/me — protected
router.get("/me", auth, async (req, res) => {
  if (!isDBReady(res)) return;
  try {
    const user = await User.findById(req.user.id).select("email createdAt");
    if (!user) return res.status(404).json({ message: "User not found" });
    return res.json({ id: user._id, email: user.email, createdAt: user.createdAt });
  } catch (err) {
    return res.status(500).json({ message: "Server error" });
  }
});

// ---------- Account settings ----------

// POST /api/auth/change-password — needs the current password; every other device is signed out
router.post(
  "/change-password",
  auth,
  changePasswordLimiter,
  [body("currentPassword").isString().notEmpty().withMessage("Enter your current password"), passwordRules()],
  async (req, res) => {
    if (!isDBReady(res)) return;
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ message: errors.array()[0].msg });

    const { currentPassword, password, confirmPassword } = req.body;
    if (confirmPassword !== undefined && password !== confirmPassword) {
      return res.status(400).json({ message: "Passwords do not match" });
    }
    const user = req.currentUser;
    try {
      // A stolen session alone can't change the password
      if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
        await audit(user.email, "password_change_failed", user.email);
        return res.status(400).json({ message: "Current password is incorrect" });
      }
      if (await bcrypt.compare(password, user.passwordHash)) {
        return res.status(400).json({ message: "Choose a password different from your current one" });
      }

      user.passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
      await user.save();

      const [{ deletedCount }] = await Promise.all([
        Session.deleteMany({ userId: user._id, _id: { $ne: req.sessionId } }),
        PasswordReset.deleteMany({ userId: user._id }),
      ]);
      await audit(user.email, "password_changed", user.email);
      try {
        await sendMail({
          to: user.email,
          subject: "Your OpSec password was changed",
          text: `The password on your OpSec account was just changed, and every other device was signed out.

If this was you, there's nothing to do.

If it wasn't, reset your password right away:
${buildUrl("/ForgotPasswordPage.html")}`,
        });
      } catch (err) {
        console.error("[password changed email]", err.code, err.message);
      }
      return res.json({ message: "Password updated", signedOut: deletedCount });
    } catch (err) {
      console.error("[change password]", err);
      return res.status(500).json({ message: "Server error" });
    }
  },
);

// ---------- Contact an admin ----------

// Labels live on the server, so nothing the user types ends up in the email subject
const CONTACT_TOPICS = {
  delete_account: "Delete my account",
  correct_data: "Correct my data",
  question: "Question about my account",
};

// POST /api/auth/contact — emails every admin; the reply goes to the signed-in user's own address
router.post(
  "/contact",
  auth,
  contactLimiter,
  [
    body("topic").isIn(Object.keys(CONTACT_TOPICS)).withMessage("Choose a request type"),
    body("message").isString().trim().isLength({ min: 1, max: 2000 }).withMessage("Write a message of up to 2000 characters"),
  ],
  async (req, res) => {
    if (!isDBReady(res)) return;
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ message: errors.array()[0].msg });

    // The email comes from the session, never from the form, so nobody can ask on someone else's behalf
    const user = req.currentUser;
    const topic = CONTACT_TOPICS[req.body.topic];
    try {
      const admins = await Admin.find().select("email").lean();
      if (!admins.length) return res.status(503).json({ message: "No admin is available to receive requests right now." });
      await sendMail({
        to: admins.map((a) => a.email).join(", "),
        replyTo: user.email,
        subject: `[OpSec] ${topic} · ${user.email}`,
        text: `Request: ${topic}
From: ${user.email} (signed in, verified by email code)
Sent: ${new Date().toUTCString()}

Message:
${req.body.message}

Reply to this email to answer the user. Account actions are done from the admin dashboard.`,
      });
      await audit(user.email, `contact_request_${req.body.topic}`, user.email);
      return res.status(202).json({ message: "Request sent. An admin will reply to your email." });
    } catch (err) {
      console.error("[contact]", err.code, err.message);
      return res.status(502).json({ message: "We couldn't send your request. Please try again." });
    }
  },
);

// ---------- Sessions (signed-in devices) ----------

// POST /api/auth/logout — ends this browser's session on the server, not just in the browser
router.post("/logout", auth, async (req, res) => {
  if (!isDBReady(res)) return;
  try {
    await Session.deleteOne({ _id: req.sessionId, userId: req.currentUser._id });
    await audit(req.currentUser.email, "logout", req.currentUser.email);
    return res.json({ message: "Logged out" });
  } catch (err) {
    console.error("[logout]", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// GET /api/auth/sessions — devices signed in to this account, current one first
router.get("/sessions", auth, async (req, res) => {
  if (!isDBReady(res)) return;
  try {
    const sessions = await Session.find({ userId: req.currentUser._id, expiresAt: { $gt: new Date() } })
      .sort({ createdAt: -1 })
      .lean();
    const list = sessions
      .map((s) => ({ id: String(s._id), device: s.device, createdAt: s.createdAt, current: String(s._id) === req.sessionId }))
      .sort((a, b) => Number(b.current) - Number(a.current));
    return res.json({ sessions: list });
  } catch (err) {
    console.error("[sessions]", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// POST /api/auth/sessions/revoke-others — log out every device except this one
router.post("/sessions/revoke-others", auth, async (req, res) => {
  if (!isDBReady(res)) return;
  try {
    const { deletedCount } = await Session.deleteMany({ userId: req.currentUser._id, _id: { $ne: req.sessionId } });
    await audit(req.currentUser.email, "sessions_revoked_others", req.currentUser.email);
    return res.json({ message: "Other devices logged out", signedOut: deletedCount });
  } catch (err) {
    console.error("[revoke others]", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// DELETE /api/auth/sessions/:id — log out one other device
router.delete("/sessions/:id", auth, async (req, res) => {
  if (!isDBReady(res)) return;
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: "Device not found" });
  if (id === req.sessionId) return res.status(400).json({ message: "Use Log out to sign out of this device" });
  try {
    // userId in the filter means nobody can end someone else's session by guessing an id
    const { deletedCount } = await Session.deleteOne({ _id: id, userId: req.currentUser._id });
    if (!deletedCount) return res.status(404).json({ message: "Device not found" });
    await audit(req.currentUser.email, "session_revoked", req.currentUser.email);
    return res.json({ message: "Device logged out" });
  } catch (err) {
    console.error("[revoke session]", err);
    return res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;


