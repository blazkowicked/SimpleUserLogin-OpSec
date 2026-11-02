const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Session = require("../models/Session");
const { deviceLabel } = require("./device");
const { sendMail, buildUrl } = require("./mailer");

const MAX_KNOWN_DEVICES = 20;

function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || "15m" });
}

// The first time a device label appears on an account that already had one, email the owner.
// A failed email never blocks the sign-in.
async function noteDevice(user, device) {
  const known = Array.isArray(user.knownDevices) ? user.knownDevices : [];
  if (known.includes(device)) return;
  await User.updateOne({ _id: user._id }, { $push: { knownDevices: { $each: [device], $slice: -MAX_KNOWN_DEVICES } } });
  if (known.length === 0) return;
  try {
    await sendMail({
      to: user.email,
      subject: "New sign-in to your OpSec account",
      text: `Your OpSec account was just signed in from a device we haven't seen before:\n\n${device}\n${new Date().toUTCString()}\n\nIf this was you, there's nothing to do.\n\nIf it wasn't, open Account settings, log out that device and change your password:\n${buildUrl("/AccountSettingsPage.html")}`,
    });
  } catch (err) {
    console.error("[new device email]", err.code, err.message);
  }
}

// Records this sign-in as a session and returns a token tied to it
async function startSession(user, req) {
  const device = deviceLabel(req.headers["user-agent"]);
  const session = new Session({ userId: user._id, device, expiresAt: new Date() });
  const token = signToken({ id: user._id, email: user.email, tokenVersion: user.tokenVersion || 0, sid: String(session._id) });
  session.expiresAt = new Date(jwt.decode(token).exp * 1000);
  await session.save();
  await noteDevice(user, device);
  return token;
}

module.exports = { startSession };
