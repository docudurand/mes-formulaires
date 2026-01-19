const logs = [];
const listeners = new Set();
const allowedLevels = new Set(["info", "warn", "error"]);

const MAX_LOGS = 500;
const MAX_AGE_MS = 5 * 60 * 1000;
let lastErrorAt = null;

function normalizeLevel(level) {
  const value = String(level || "").toLowerCase().trim();
  return allowedLevels.has(value) ? value : "info";
}

function safeClone(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function normalizeEntry(level, message, context) {
  let normalizedContext = context ?? null;
  let normalizedMessage = message;
  const nowMs = Date.now();

  if (message instanceof Error) {
    const errorInfo = {
      name: message.name,
      message: message.message,
      stack: message.stack,
    };
    normalizedMessage = message.message || message.name;
    if (normalizedContext && typeof normalizedContext === "object") {
      normalizedContext = { ...normalizedContext, error: errorInfo };
    } else {
      normalizedContext = { error: errorInfo };
    }
  }

  return {
    ts: new Date(nowMs).toISOString(),
    level: normalizeLevel(level),
    message: String(normalizedMessage ?? ""),
    context: normalizedContext,
  };
}

function entryTimeMs(entry, nowMs) {
  const parsed = Date.parse(entry?.ts);
  return Number.isFinite(parsed) ? parsed : nowMs;
}

function prune(nowMs = Date.now()) {
  while (logs.length > 0) {
    const tooMany = logs.length > MAX_LOGS;
    const tooOld = nowMs - entryTimeMs(logs[0], nowMs) > MAX_AGE_MS;
    if (!tooMany && !tooOld) break;
    logs.shift();
  }
}

function isRecentError(nowMs = Date.now()) {
  if (!lastErrorAt) return false;
  const parsed = Date.parse(lastErrorAt);
  if (!Number.isFinite(parsed)) return false;
  return nowMs - parsed <= MAX_AGE_MS;
}

export function log(level, message, context = null) {
  const entry = normalizeEntry(level, message, context);

  logs.push(entry);
  if (entry.level === "error") {
    lastErrorAt = entry.ts;
  }

  listeners.forEach((listener) => {
    try {
      listener(entry);
    } catch {
      // Ignore listener errors to avoid breaking logging.
    }
  });

  prune();
  return entry;
}

export function getLastLogs() {
  prune();
  return safeClone(logs);
}

export function onLog(listener) {
  if (typeof listener !== "function") return () => {};
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getHealthStatus() {
  return {
    status: isRecentError() ? "error" : "ok",
    lastErrorAt,
  };
}

export function __resetForTests() {
  logs.length = 0;
  listeners.clear();
  lastErrorAt = null;
}
