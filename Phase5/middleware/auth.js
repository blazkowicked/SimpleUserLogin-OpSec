const jwt = require("jsonwebtoken");
const User = require("../models/User");

async function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: "No token, authorization denied" });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ message: "Token invalid or expired" });
    }
    const now = new Date();
    if (user.lockUntil && user.lockUntil > now) {
      return res.status(401).json({ message: "Token invalid or expired" });
    }
    const tokenVersion = typeof decoded.tokenVersion === "number" ? decoded.tokenVersion : 0;
    const userTokenVersion = typeof user.tokenVersion === "number" ? user.tokenVersion : 0;
    if (tokenVersion !== userTokenVersion) {
      return res.status(401).json({ message: "Token invalid or expired" });
    }
    req.user = decoded;
    req.currentUser = user;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Token invalid or expired" });
  }
}

module.exports = auth;
