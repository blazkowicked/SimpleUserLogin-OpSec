const mongoose = require("mongoose");

// One document per signed-in browser. The token carries this document's id (sid),
// so deleting the document signs that browser out on its next request.
const sessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  // Short label like "Chrome on macOS". The raw User-Agent header is never stored.
  device: {
    type: String,
    required: true,
    maxlength: 64,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  // Same moment the token expires
  expiresAt: {
    type: Date,
    required: true,
  },
});

// MongoDB removes a session on its own once its token has expired
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("Session", sessionSchema);
