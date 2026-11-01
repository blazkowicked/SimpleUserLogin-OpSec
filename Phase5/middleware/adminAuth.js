const jwt = require("jsonwebtoken");

function adminAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: "No token, authorization denied" });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "dev-only-replace-me-please-generate-random-hex");
    if (decoded.role !== "admin") {
      return res.status(403).json({ message: "Forbidden: admin access required" });
    }
    req.admin = decoded;
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Token invalid or expired" });
  }
}

module.exports = adminAuth;
