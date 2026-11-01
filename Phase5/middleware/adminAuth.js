const jwt = require("jsonwebtoken");
const Admin = require("../models/Admin");

async function adminAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: "No token, authorization denied" });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== "admin") {
      return res.status(403).json({ message: "Forbidden: admin access required" });
    }
    const admin = await Admin.findById(decoded.id);
    if (!admin) {
      return res.status(401).json({ message: "Token invalid or expired" });
    }
    const now = new Date();
    if (admin.lockUntil && admin.lockUntil > now) {
      return res.status(401).json({ message: "Token invalid or expired" });
    }
    const tokenVersion = typeof decoded.tokenVersion === "number" ? decoded.tokenVersion : 0;
    const adminTokenVersion = typeof admin.tokenVersion === "number" ? admin.tokenVersion : 0;
    if (tokenVersion !== adminTokenVersion) {
      return res.status(401).json({ message: "Token invalid or expired" });
    }
    req.admin = decoded;
    req.adminDoc = admin;
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Token invalid or expired" });
  }
}

module.exports = adminAuth;
