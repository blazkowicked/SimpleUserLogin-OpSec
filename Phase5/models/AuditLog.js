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

module.exports = mongoose.model("AuditLog", auditLogSchema);
