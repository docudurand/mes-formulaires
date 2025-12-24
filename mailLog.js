// mailLog.js
// Log des envois e-mail vers Google Sheets via une Web App Apps Script.
//
// Variables d'env requises :
// - GS_MAIL_LOG_URL : URL de la Web App Apps Script (déployée en "Tout le monde").
// Optionnel :
// - GS_MAIL_LOG_TIMEOUT_MS (défaut 15000)
//
// Côté Apps Script, voir le fichier apps-script-mail-logs.gs fourni dans l'archive.

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
      throw new Error(`[MAIL_LOG] HTTP ${res.status} ${res.statusText} :: ${text}`.slice(0, 500));
    }
    return data;
  } finally {
    clear();
  }
}

/**
 * Ajoute une ligne de log dans Google Sheets.
 * entry attendu :
 *  - ts (ISO string)    ex: new Date().toISOString()
 *  - to (string)        destinataire(s)
 *  - formType (string)  ex: "garantie", "atelier", "ramasse", ...
 *  - status (string)    "sent" | "failed"
 *  - error (string?)    message d'erreur si échec
 *  - meta (object?)     infos optionnelles (id dossier, agence, etc.)
 */
export async function addMailLog(entry) {
  assertConfigured();
  const payload = { action: "appendMailLog", entry };
  return httpJson(GS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  });
}

/**
 * Récupère les derniers logs pour l'interface.
 * @param {object} opts
 * @param {number} opts.limit - max lignes (défaut 200)
 * @param {string} opts.q - filtre texte (email / type / statut / erreur)
 */
export async function getMailLogs({ limit = 200, q = "" } = {}) {
  assertConfigured();
  const u = new URL(GS_URL);
  u.searchParams.set("action", "listMailLogs");
  u.searchParams.set("limit", String(limit));
  if (q) u.searchParams.set("q", q);
  return httpJson(u.toString(), { method: "GET" });
}

/**
 * Helper : envoie un mail via nodemailer et log automatiquement.
 * @param {object} transporter nodemailer transporter
 * @param {object} mailOptions options sendMail
 * @param {string} formType type de formulaire
 * @param {object} meta infos optionnelles
 */
export async function sendMailWithLog(transporter, mailOptions, formType, meta = {}) {
  const toField = Array.isArray(mailOptions?.to) ? mailOptions.to.join(",") : (mailOptions?.to || "");
  const base = {
    ts: new Date().toISOString(),
    to: toField,
    formType: String(formType || "unknown"),
    meta,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    await addMailLog({ ...base, status: "sent", messageId: info?.messageId || "" });
    return info;
  } catch (err) {
    const msg = String(err?.message || err);
    try {
      await addMailLog({ ...base, status: "failed", error: msg });
    } catch {
      // ne pas casser le flux si le log échoue
    }
    throw err;
  }
}
