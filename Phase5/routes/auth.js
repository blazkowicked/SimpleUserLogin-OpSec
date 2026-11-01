const express = require("express");
const { body, validationResult } = require("express-validator");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = require("../models/User");
const AuditLog = require("../models/AuditLog");
const auth = require("../middleware/auth");
const createRateLimiter = require("../middleware/rateLimiter");

const router = express.Router();

const SALT_ROUNDS = 10;
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("dummy-password-for-timing", SALT_ROUNDS);
const LOCK_DURATION_MS = 24 * 60 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;

const authLoginLimiter = createRateLimiter({
  scope: "auth_login",
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many requests, please try again later.",
});

const authSignupLimiter = createRateLimiter({
  scope: "auth_signup",
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many requests, please try again later.",
});

function isDBReady(res) {
  if (mongoose.connection.readyState !== 1) {
    res.status(503).json({
      message: "Database not connected. Set real MONGODB_URI in Phase5/.env and restart server.",
    });
    return false;
  }
  return true;
}

function signToken(payload) {
  const expiresIn = process.env.JWT_EXPIRES_IN || "15m";
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn,
  });
}

// POST /api/auth/signup
router.post(
  "/signup",
  authSignupLimiter,
  [
    body("email").trim().isEmail().withMessage("Valid email required").isLength({ max: 254 }),
    body("password")
      .isLength({ min: 8, max: 128 })
      .withMessage("Password must be at least 8 characters")
      .matches(/[A-Za-z]/)
      .withMessage("Password must contain letters"),
  ],
  async (req, res) => {
    if (!isDBReady(res)) return;
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ message: errors.array()[0].msg, errors: errors.array() });

    const { email, password, confirmPassword } = req.body;
    if (confirmPassword !== undefined && password !== confirmPassword) {
      return res.status(400).json({ message: "Passwords do not match" });
    }
    try {
      const normalized = email.toLowerCase().trim();
      const existing = await User.findOne({ email: normalized });
      if (existing) return res.status(409).json({ message: "Email already registered" });

      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
      const user = await User.create({ email: normalized, passwordHash, tokenVersion: 0, failedLoginAttempts: 0, lockUntil: null, isLocked: false });
      AuditLog.create({ email: normalized, action: "signup", actor: normalized }).catch((err) => console.error("[audit signup]", err));
      const token = signToken({ id: user._id, email: user.email, tokenVersion: user.tokenVersion || 0 });
      return res.status(201).json({ token, user: { id: user._id, email: user.email } });
    } catch (err) {
      console.error("[signup]", err);
      if (err.code === 11000) return res.status(409).json({ message: "Email already registered" });
      return res.status(500).json({ message: "Server error during signup" });
    }
  },
);

// POST /api/auth/login
router.post(
  "/login",
  authLoginLimiter,
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

      if (user.failedLoginAttempts !== 0 || user.lockUntil) {
        user.failedLoginAttempts = 0;
        user.lockUntil = null;
        user.isLocked = false;
        await user.save();
      }

      AuditLog.create({ email: normalized, action: "login_success", actor: normalized }).catch((err) => console.error("[audit login_success]", err));
      const token = signToken({ id: user._id, email: user.email, tokenVersion: user.tokenVersion || 0 });
      return res.json({ token, user: { id: user._id, email: user.email } });
    } catch (err) {
      console.error("[login]", err);
      try {
        await bcrypt.compare(password || "", DUMMY_PASSWORD_HASH);
      } catch (_) {}
      return res.status(401).json({ message: "Invalid credentials" });
    }
  },
);

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

module.exports = router;

