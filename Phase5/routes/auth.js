const express = require("express");
const { body, validationResult } = require("express-validator");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = require("../models/User");
const AuditLog = require("../models/AuditLog");
const auth = require("../middleware/auth");

const router = express.Router();

const SALT_ROUNDS = 10;

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
  return jwt.sign(payload, process.env.JWT_SECRET || "dev-only-replace-me-please-generate-random-hex", {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
}

// POST /api/auth/signup
router.post(
  "/signup",
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
      const user = await User.create({ email: normalized, passwordHash });
      AuditLog.create({ email: normalized, action: "signup" }).catch((err) => console.error("[audit signup]", err));
      const token = signToken({ id: user._id, email: user.email });
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
  [body("email").trim().isEmail().withMessage("Valid email required"), body("password").notEmpty().withMessage("Password is required")],
  async (req, res) => {
    if (!isDBReady(res)) return;
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ message: errors.array()[0].msg });

    const { email, password } = req.body;
    try {
      const normalized = email.toLowerCase().trim();
      const user = await User.findOne({ email: normalized });
      if (!user) {
        AuditLog.create({ email: normalized, action: "login_failure" }).catch((err) => console.error("[audit login_failure]", err));
        return res.status(401).json({ message: "Invalid credentials" });
      }

      if (user.isLocked) {
        return res.status(403).json({ message: "Account locked. Contact an administrator." });
      }

      const match = await bcrypt.compare(password, user.passwordHash);
      if (!match) {
        AuditLog.create({ email: normalized, action: "login_failure" }).catch((err) => console.error("[audit login_failure]", err));
        user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
        if (user.failedLoginAttempts >= 5) {
          user.isLocked = true;
          AuditLog.create({ email: normalized, action: "account_locked" }).catch((err) => console.error("[audit account_locked]", err));
        }
        await user.save();
        const remaining = Math.max(0, 5 - user.failedLoginAttempts);
        const isNowLocked = user.isLocked;
        const msg = isNowLocked
          ? "Invalid credentials. Account locked after 5 failed attempts. Contact an administrator."
          : `Invalid credentials. ${remaining} attempt(s) remaining before account is locked.`;
        return res.status(401).json({
          message: msg,
          failedLoginAttempts: user.failedLoginAttempts,
          attemptsRemaining: remaining,
          isLocked: isNowLocked,
        });
      }

      if (user.failedLoginAttempts !== 0) {
        user.failedLoginAttempts = 0;
        await user.save();
      }

      AuditLog.create({ email: normalized, action: "login_success" }).catch((err) => console.error("[audit login_success]", err));
      const token = signToken({ id: user._id, email: user.email });
      return res.json({ token, user: { id: user._id, email: user.email } });
    } catch (err) {
      console.error("[login]", err);
      return res.status(500).json({ message: "Server error during login" });
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
