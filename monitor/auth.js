const ENABLED_VALUE = "true";
const COOKIE_NAME = "monitor_token";

function isMonitorEnabled() {
  return String(process.env.MONITOR_ENABLED || "").toLowerCase() === ENABLED_VALUE;
}

function parseCookie(header) {
  if (!header) return {};
  const out = {};
  String(header)
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const idx = part.indexOf("=");
      if (idx === -1) return;
      const key = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim();
      if (key) out[key] = value;
    });
  return out;
}

function isSecureRequest(req) {
  if (req?.secure === true) return true;
  const proto = req?.headers?.["x-forwarded-proto"] || req?.headers?.["x-forwarded-protocol"];
  if (!proto) return false;
  return String(proto).split(",")[0].trim().toLowerCase() === "https";
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getBearerToken(req) {
  const header = req?.get ? req.get("Authorization") : req?.headers?.authorization;
  if (header) {
    const value = String(header).trim();
    if (value.toLowerCase().startsWith("bearer ")) return value.slice(7).trim();
  }

  const queryToken = req?.query?.token;
  if (Array.isArray(queryToken)) return String(queryToken[0] || "").trim();
  if (queryToken != null) return String(queryToken).trim();

  const cookieHeader = req?.headers?.cookie;
  const cookies = parseCookie(cookieHeader);
  if (cookies[COOKIE_NAME]) return safeDecode(String(cookies[COOKIE_NAME]).trim());

  return "";
}

function setAuthCookie(res, token, secure) {
  const secureFlag = secure ? "; Secure" : "";
  const value = `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${secureFlag}`;
  const existing = res.getHeader ? res.getHeader("Set-Cookie") : undefined;
  if (existing) {
    const list = Array.isArray(existing) ? existing : [existing];
    if (!list.includes(value)) {
      res.setHeader("Set-Cookie", [...list, value]);
    }
  } else if (res.setHeader) {
    res.setHeader("Set-Cookie", value);
  }
}

export function monitorAuth(req, res, next) {
  if (!isMonitorEnabled()) {
    return res.status(404).json({ error: "monitor_disabled" });
  }

  const expected = String(process.env.MONITOR_TOKEN || "").trim();
  if (!expected) {
    return res.status(500).json({ error: "monitor_token_missing" });
  }

  const token = getBearerToken(req);
  if (!token || token !== expected) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const cookies = parseCookie(req?.headers?.cookie);
  if (!cookies[COOKIE_NAME]) {
    setAuthCookie(res, token, isSecureRequest(req));
  }

  return next();
}
