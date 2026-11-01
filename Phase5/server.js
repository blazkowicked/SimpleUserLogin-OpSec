require("dotenv").config();
const express = require("express");
const path = require("path");
const cors = require("cors");
const connectDB = require("./config/db");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  next();
});

// Health check — always works, even if DB not connected
app.get("/health", (_req, res) => {
  const states = ["disconnected", "connected", "connecting", "disconnecting"];
  const mongoose = require("mongoose");
  res.json({
    status: "ok",
    db: states[mongoose.connection.readyState] || "unknown",
    time: new Date().toISOString(),
  });
});

app.use("/api/auth", require("./routes/auth"));
app.use("/api/admin", require("./routes/admin"));

// Serve only the frontend folder
app.use(express.static(path.join(__dirname, "public"), { index: false }));

// Block sensitive files — return 404 instead of content
app.get("/.env", (_req, res) => res.status(404).send("Not found"));
app.get("/server.js", (_req, res) => res.status(404).send("Not found"));

app.get("/", (_req, res) => {
  res.redirect("/LoginPage.html");
});

app.use("/api", (_req, res) => res.status(404).json({ message: "API route not found" }));

(async () => {
  await connectDB(process.env.MONGODB_URI);
  const uri = process.env.MONGODB_URI || "";
  const isPlaceholderSrv = !uri || uri.includes("xxxxx") || /PASSWORD/i.test(uri) || uri.includes("<") || uri.includes(">");
  if (isPlaceholderSrv) {
    console.log("\n[INFO] MONGODB_URI still placeholder — set real Atlas URI in Phase5/.env:");
    console.log("       MONGODB_URI=mongodb+srv://appuser:PASSWORD@cluster0.xxx.mongodb.net/userlogin?retryWrites=true&w=majority");
    console.log("       Then restart: npm run dev\n");
  }
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.includes("dev-only")) {
    console.warn("[WARN] JWT_SECRET is placeholder. Run: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\" and paste into Phase5/.env");
  }

  app.listen(PORT, () => {
    console.log(`[Server] Listening on http://localhost:${PORT}`);
    console.log(`[Server] Health: http://localhost:${PORT}/health`);
    console.log(`[Server] Login:  http://localhost:${PORT}/LoginPage.html`);
  });
})();
