function getRealIp(req) {
  if (req.ip) {
    return req.ip;
  }
  const xff = req.headers["x-forwarded-for"];
  if (xff) {
    const first = Array.isArray(xff) ? xff[0] : xff;
    if (typeof first === "string" && first.includes(",")) {
      return first.split(",")[0].trim();
    }
    if (typeof first === "string") {
      return first.trim();
    }
  }
  const xri = req.headers["x-real-ip"];
  if (xri) {
    const val = Array.isArray(xri) ? xri[0] : xri;
    if (typeof val === "string") return val.trim();
  }
  if (req.socket && req.socket.remoteAddress) {
    return req.socket.remoteAddress;
  }
  return "unknown";
}

module.exports = getRealIp;
