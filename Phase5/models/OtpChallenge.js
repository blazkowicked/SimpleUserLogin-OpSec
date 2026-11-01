const mongoose = require("mongoose");

const otpChallengeSchema = new mongoose.Schema({
  purpose: {
    type: String,
    enum: ["signup", "login", "admin_login"],
    required: true,
  },
  email: {
    type: String,
    required: true,
  },
  // User or Admin _id. Null for signup: the account does not exist until the code is verified.
  subjectId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null,
  },
  pendingPasswordHash: {
    type: String,
    default: null,
  },
  // "code" emails a real code. "notice" and "none" are signup decoys that can never verify.
  delivery: {
    type: String,
    enum: ["code", "notice", "none"],
    default: "code",
  },
  codeHash: {
    type: String,
    required: true,
  },
  codeExpiresAt: {
    type: Date,
    required: true,
  },
  attempts: {
    type: Number,
    default: 0,
  },
  sendCount: {
    type: Number,
    default: 1,
  },
  lastSentAt: {
    type: Date,
    required: true,
  },
  expiresAt: {
    type: Date,
    required: true,
  },
});

otpChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
otpChallengeSchema.index({ purpose: 1, subjectId: 1 });
otpChallengeSchema.index({ purpose: 1, email: 1 });

module.exports = mongoose.model("OtpChallenge", otpChallengeSchema);
