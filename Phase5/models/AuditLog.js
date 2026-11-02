const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
  },
  actor: {
    type: String,
    required: false,
  },
  action: {
    type: String,
    required: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

// Privacy policy: audit entries are kept for 10 years, then MongoDB deletes them on its own
const TEN_YEARS_SECONDS = 10 * 365 * 24 * 60 * 60 + 2 * 24 * 60 * 60; // includes the leap days
auditLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: TEN_YEARS_SECONDS });

module.exports = mongoose.model("AuditLog", auditLogSchema);
