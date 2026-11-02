// Turns a User-Agent header into a short label like "Chrome on macOS".
// The header is self-reported, so the label is a hint for the user, not proof of identity.
function browserName(ua) {
  if (/Edg(e|A|iOS)?\//.test(ua)) return "Edge";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/SamsungBrowser\//.test(ua)) return "Samsung Internet";
  if (/Firefox\/|FxiOS\//.test(ua)) return "Firefox";
  if (/Chrome\/|CriOS\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return "Safari";
  return "A browser";
}

function osName(ua) {
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Windows NT/.test(ua)) return "Windows";
  if (/CrOS/.test(ua)) return "ChromeOS";
  if (/Mac OS X|Macintosh/.test(ua)) return "macOS";
  if (/Linux/.test(ua)) return "Linux";
  return "an unknown device";
}

function deviceLabel(userAgent) {
  const ua = String(userAgent || "").slice(0, 512);
  return `${browserName(ua)} on ${osName(ua)}`;
}

module.exports = { deviceLabel };
