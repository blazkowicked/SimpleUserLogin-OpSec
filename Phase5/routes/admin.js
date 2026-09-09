const express = require("express");
const { body, validationResult } = require("express-validator");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const Admin = require("../models/Admin");
const User = require("../models/User");
const AuditLog = require("../models/AuditLog");
const adminAuth = require("../middleware/adminAuth");

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

// POST /api/admin/login
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
      const admin = await Admin.findOne({ email: normalized });
      if (!admin) {
        return res.status(401).json({ message: "Invalid credentials" });
      }
      const match = await bcrypt.compare(password, admin.passwordHash);
      if (!match) {
        return res.status(401).json({ message: "Invalid credentials" });
      }
      const token = signToken({ id: admin._id, email: admin.email, role: "admin" });
      return res.json({ token, admin: { id: admin._id, email: admin.email } });
    } catch (err) {
      console.error("[admin login]", err);
      return res.status(500).json({ message: "Server error during admin login" });
    }
  },
);

// GET /api/admin/users — protected admin
router.get("/users", adminAuth, async (req, res) => {
  if (!isDBReady(res)) return;
  try {
    const users = await User.find({}).select("email isLocked failedLoginAttempts createdAt").sort({ createdAt: -1 });
    const result = users.map((u) => ({
      id: u._id,
      _id: u._id,
      email: u.email,
      isLocked: !!u.isLocked,
      failedLoginAttempts: u.failedLoginAttempts ?? 0,
      createdAt: u.createdAt,
    }));
    return res.json({ users: result });
  } catch (err) {
    console.error("[admin users]", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// POST /api/admin/unlock/:userId — protected admin
router.post("/unlock/:userId", adminAuth, async (req, res) => {
  if (!isDBReady(res)) return;
  const { userId } = req.params;
  if (!mongoose.isValidObjectId(userId)) {
    return res.status(400).json({ message: "Invalid user ID" });
  }
  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.isLocked = false;
    user.failedLoginAttempts = 0;
    await user.save();

    AuditLog.create({ email: user.email, action: "account_unlocked" }).catch((err) => console.error("[audit account_unlocked]", err));

    return res.json({ message: "Account unlocked", user: { id: user._id, email: user.email, isLocked: user.isLocked } });
  } catch (err) {
    console.error("[admin unlock]", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// PUT /api/admin/users/:userId/password — change user password (admin)
router.put(
  "/users/:userId/password",
  adminAuth,
  [
    body("newPassword")
      .isLength({ min: 8, max: 128 })
      .withMessage("Password must be at least 8 characters")
      .matches(/[A-Za-z]/)
      .withMessage("Password must contain letters"),
  ],
  async (req, res) => {
    if (!isDBReady(res)) return;
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ message: errors.array()[0].msg, errors: errors.array() });

    const { userId } = req.params;
    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }
    const { newPassword } = req.body;
    try {
      const user = await User.findById(userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
      user.passwordHash = passwordHash;
      // reset lock as requested (yes)
      user.isLocked = false;
      user.failedLoginAttempts = 0;
      await user.save();

      AuditLog.create({ email: user.email, action: "admin_password_changed" }).catch((err) => console.error("[audit admin_password_changed]", err));

      return res.json({ message: "Password updated", user: { id: user._id, email: user.email } });
    } catch (err) {
      console.error("[admin change pw]", err);
      return res.status(500).json({ message: "Server error" });
    }
  },
);

// DELETE /api/admin/users/:userId — delete user (admin)
router.delete("/users/:userId", adminAuth, async (req, res) => {
  if (!isDBReady(res)) return;
  const { userId } = req.params;
  if (!mongoose.isValidObjectId(userId)) {
    return res.status(400).json({ message: "Invalid user ID" });
  }
  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const email = user.email;
    await User.deleteOne({ _id: user._id });

    // keep audit logs as requested (yes) — just add deletion entry
    AuditLog.create({ email, action: "account_deleted" }).catch((err) => console.error("[audit account_deleted]", err));

    return res.json({ message: "User deleted", user: { id: userId, email } });
  } catch (err) {
    console.error("[admin delete]", err);
    return res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
