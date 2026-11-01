require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Admin = require("../models/Admin");
const { passwordProblem } = require("../utils/passwordPolicy");

const SALT_ROUNDS = 10;

async function seed() {
  // No defaults: a known default password is a free admin login, and admin login
  // now sends a code by email, so the address has to be a real inbox.
  const email = String(process.env.ADMIN_EMAIL || "").toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD || "";

  if (!email || !/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)) {
    console.error("[seedAdmin] Set ADMIN_EMAIL in Phase5/.env to a real inbox. Admin login sends a verification code there.");
    process.exit(1);
  }
  const problem = passwordProblem(password);
  if (problem) {
    console.error(`[seedAdmin] ADMIN_PASSWORD in Phase5/.env is not strong enough: ${problem}.`);
    process.exit(1);
  }

  if (!process.env.MONGODB_URI) {
    console.error("[seedAdmin] MONGODB_URI missing in Phase5/.env");
    process.exit(1);
  }

  await connectDB(process.env.MONGODB_URI);

  if (mongoose.connection.readyState !== 1) {
    console.error("[seedAdmin] DB not connected — check MONGODB_URI in Phase5/.env");
    process.exit(1);
  }

  const existing = await Admin.findOne({ email });
  if (existing) {
    console.log(`[seedAdmin] Admin already exists: ${existing.email} (${existing._id})`);
    // Optionally update password if ADMIN_PASSWORD provided and differs — skip unless --force
    if (process.argv.includes("--force")) {
      existing.passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
      await existing.save();
      console.log("[seedAdmin] Password updated due to --force");
    }
    await mongoose.disconnect();
    process.exit(0);
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const admin = await Admin.create({ email, passwordHash });
  console.log(`[seedAdmin] Created admin: ${admin.email} (${admin._id})`);
  console.log(`[seedAdmin] Login at POST /api/admin/login with email: ${email}`);
  await mongoose.disconnect();
  process.exit(0);
}

seed().catch((err) => {
  console.error("[seedAdmin] Error:", err);
  mongoose.disconnect().finally(() => process.exit(1));
});
