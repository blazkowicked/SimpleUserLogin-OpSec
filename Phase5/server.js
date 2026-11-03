require("dotenv").config();
const express = require("express");
const path = require("path");
const helmet = require("helmet");
const connectDB = require("./config/db");
const getRealIp = require("./utils/getRealIp");

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.JWT_SECRET || !String(process.env.JWT_SECRET).trim()) {
  console.error("[FATAL] JWT_SECRET missing in .env");
  process.exit(1);
}

app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(
  helmet({
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        // Cloudflare Turnstile loads a script and draws the check inside an iframe
        scriptSrc: ["'self'", "https://challenges.cloudflare.com"],
        frameSrc: ["https://challenges.cloudflare.com"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"],
      },
    },
  }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, _res, next) => {
  const proto = req.protocol || req.headers["x-forwarded-proto"] || "http";
  const ip = getRealIp(req);
  console.log(`${new Date().toISOString()} ${req.method} ${req.url} proto=${proto} ip=${ip}`);
  next();
});

// Health check — trimmed (no DB state)
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    time: new Date().toISOString(),
  });
});

// Public Turnstile site key for the browser widget (not a secret)
app.get("/api/config/turnstile", (_req, res) => {
  const siteKey = require("./utils/turnstile").getSiteKey();
  if (!siteKey) return res.status(503).json({ message: "Human check is not configured" });
  return res.json({ siteKey });
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
  const isPlaceholderSrv =
    !uri ||
    uri.includes("xxxxx") ||
    /PASSWORD/i.test(uri) ||
    uri.includes("<") ||
    uri.includes(">") ||
    /<.*password.*>/i.test(uri);
  if (isPlaceholderSrv) {
    console.log("\n[INFO] MONGODB_URI still placeholder — set real Atlas URI in Phase5/.env:");
    console.log("       MONGODB_URI=mongodb+srv://appuser:PASSWORD@cluster0.xxx.mongodb.net/userlogin?retryWrites=true&w=majority");
    console.log("       Then restart: npm run dev\n");
  }

  app.listen(PORT, () => {
    console.log(`[Server] Listening on http://localhost:${PORT}`);
    console.log(`[Server] Health: http://localhost:${PORT}/health`);
    console.log(`[Server] Login:  http://localhost:${PORT}/LoginPage.html`);
  });
})();
