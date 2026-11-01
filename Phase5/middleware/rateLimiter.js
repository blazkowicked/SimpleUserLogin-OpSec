const RateLimit = require("../models/RateLimit");
const getRealIp = require("../utils/getRealIp");

function createRateLimiter(options = {}) {
  const {
    scope = "global",
    windowMs = 15 * 60 * 1000,
    max = 100,
    keyFn = (req) => {
      const ip = getRealIp(req);
      return `ip:${ip}`;
    },
    message = "Too many requests, please try again later.",
  } = options;

  return async function rateLimiter(req, res, next) {
    try {
      const identifier = typeof keyFn === "function" ? keyFn(req) : getRealIp(req);
      const key = `${scope}:${identifier}`;
      const now = new Date();
      const expiresAt = new Date(now.getTime() + windowMs);

      let entry = await RateLimit.findOne({ key });
      if (!entry) {
        try {
          entry = await RateLimit.create({ key, count: 1, expiresAt });
          return next();
        } catch (err) {
          if (err.code === 11000) {
            entry = await RateLimit.findOne({ key });
          } else {
            throw err;
          }
        }
      }

      if (entry.expiresAt <= now) {
        entry.count = 1;
        entry.expiresAt = expiresAt;
        await entry.save();
        return next();
      }

      if (entry.count >= max) {
        return res.status(429).json({ message });
      }

      entry.count += 1;
      await entry.save();
      return next();
    } catch (err) {
      console.error("[rateLimiter]", err);
      return next();
    }
  };
}

module.exports = createRateLimiter;
module.exports.getRealIp = getRealIp;
