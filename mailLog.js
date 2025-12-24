const GS_URL = process.env.GS_MAIL_LOG_URL || "";
const TIMEOUT = Number(process.env.GS_MAIL_LOG_TIMEOUT_MS || 15000);

function assertConfigured() {
  if (!GS_URL) {
    throw new Error("[MAIL_LOG] GS_MAIL_LOG_URL manquant (Apps Script Web App).");
  }
}

function withTimeout(ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { ctrl, clear: () => clearTimeout(t) };
}

async function httpJson(url, options = {}) {
  const { ctrl, clear } = withTimeout(TIMEOUT);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!res.ok) {
      throw new Error(
        `[MAIL_LOG] HTTP ${res.status} ${res.statusText} :: ${text}`.slice(0, 500)
      );
    }
    return data;
  } finally {
    clear();
  }
}

export async function addMailLog(entry) {
  assertConfigured();
  const payload = { action: "appendMailLog", entry };
  return httpJson(GS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  });
}

export async function getMailLogs({ limit = 200, q = "" } = {}) {
  assertConfigured();
  const u = new URL(GS_URL);
  u.searchParams.set("action", "listMailLogs");
  u.searchParams.set("limit", String(limit));
  if (q) u.searchParams.set("q", q);
  return httpJson(u.toString(), { method: "GET" });
}

export async function sendMailWithLog(transporter, mailOptions, formType, meta = {}) {
  const toField = Array.isArray(mailOptions?.to)
    ? mailOptions.to.join(",")
    : (mailOptions?.to || "");

  const base = {
    ts: new Date().toISOString(),
    to: toField,
    formType: String(formType || "unknown"),
    meta,
  };

  try {
    const info = await transporter.sendMail(mailOptions);

    try {
      await addMailLog({
        ...base,
        status: "sent",
        messageId: info?.messageId || "",
      });
    } catch (e) {
      console.warn("[MAIL_LOG] log SENT failed:", e?.message || e);
    }

    return info;
  } catch (err) {
    const msg = String(err?.message || err);
    try {
      await addMailLog({ ...base, status: "failed", error: msg });
    } catch (e) {
      console.warn("[MAIL_LOG] log FAILED failed:", e?.message || e);
    }
    throw err;
  }
}
