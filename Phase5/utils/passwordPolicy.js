const { body } = require("express-validator");

// Same rules as public/password-rules.js, which only drives the checklist.
// The server is the one that enforces them.
const MAX_BYTES = 72; // bcrypt ignores everything past 72 bytes

const RULES = [
  { test: (p) => p.length >= 8, message: "Password must be at least 8 characters" },
  { test: (p) => /[A-Z]/.test(p), message: "Password must contain an uppercase letter" },
  { test: (p) => /[a-z]/.test(p), message: "Password must contain a lowercase letter" },
  { test: (p) => /[0-9]/.test(p), message: "Password must contain a number" },
  { test: (p) => /[^A-Za-z0-9]/.test(p), message: "Password must contain a symbol" },
  { test: (p) => Buffer.byteLength(p, "utf8") <= MAX_BYTES, message: "Password is too long (72 characters max)" },
];

// Returns the first rule the password breaks, or null if it passes them all
function passwordProblem(password) {
  if (typeof password !== "string" || !password) return "Password is required";
  const failed = RULES.find((rule) => !rule.test(password));
  return failed ? failed.message : null;
}

// express-validator check for a request body field
function passwordField(field = "password") {
  return body(field).custom((value) => {
    const problem = passwordProblem(value);
    if (problem) throw new Error(problem);
    return true;
  });
}

module.exports = { passwordProblem, passwordField, MAX_BYTES };
