const ENABLED_VALUE = "true";

function isMonitorEnabled() {
  return String(process.env.MONITOR_ENABLED || "").toLowerCase() === ENABLED_VALUE;
}

function getBearerToken(req) {
  const header = req?.get ? req.get("Authorization") : req?.headers?.authorization;
  if (!header) return "";
  const value = String(header).trim();
  if (!value.toLowerCase().startsWith("bearer ")) return "";
  return value.slice(7).trim();
}

export function monitorAuth(req, res, next) {
  if (!isMonitorEnabled()) return next();

  const expected = String(process.env.MONITOR_TOKEN || "").trim();
  if (!expected) {
    return res.status(500).json({ error: "monitor_token_missing" });
  }

  const token = getBearerToken(req);
  if (!token || token !== expected) {
    return res.status(401).json({ error: "unauthorized" });
  }

  return next();
}
