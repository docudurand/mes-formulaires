// /garantie/router.js
// Garantie Router for mes-formulaires
//
// This module encapsulates all the API routes required to support the
// Durand Services Garantie workflow. It is adapted from the separate
// warrantydurand project and exposes the same endpoints under a
// configurable base path.  When mounted at `/garantie/api` in your
// main server, the final routes become `/garantie/api/demandes`,
// `/garantie/api/mes-dossiers`, `/garantie/api/admin/*`, etc.

import express from "express";
import path from "path";
import fs from "fs";
import fsp from "fs/promises";
import crypto from "crypto";
import multer from "multer";
import nodemailer from "nodemailer";
import ExcelJS from "exceljs";

const router = express.Router();

// --------------------------
// Utils
// --------------------------
function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function safeBasename(name) {
  return String(name || "")
    .replace(/[^\w.\-() ]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function nowIso() {
  return new Date().toISOString();
}

function parseBool(val, fallback = false) {
  if (val == null) return fallback;
  const v = String(val).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(v)) return true;
  if (["0", "false", "no", "n", "off"].includes(v)) return false;
  return fallback;
}

function jsonEnv(key, fallback) {
  try {
    const raw = process.env[key];
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function makeId() {
  return crypto.randomBytes(8).toString("hex");
}

// --------------------------
// Paths & storage
// --------------------------
const BASE_DIR = path.join(process.cwd(), "garantie");
const DATA_DIR = path.join(BASE_DIR, "data");
const UPLOAD_DIR = path.join(BASE_DIR, "uploads");
const TEMPLATES_DIR = path.join(BASE_DIR, "templates");

ensureDirSync(DATA_DIR);
ensureDirSync(UPLOAD_DIR);
ensureDirSync(TEMPLATES_DIR);

const DEMANDES_JSON = path.join(DATA_DIR, "demandes.json");

// Load/save demandes (simple file DB)
async function loadDemandes() {
  try {
    const raw = await fsp.readFile(DEMANDES_JSON, "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function saveDemandes(arr) {
  const tmp = DEMANDES_JSON + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify(arr, null, 2), "utf-8");
  await fsp.rename(tmp, DEMANDES_JSON);
}

// --------------------------
// Multer (uploads)
// --------------------------
const storage = multer.diskStorage({
  destination: function (_req, _file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename: function (_req, file, cb) {
    const base = safeBasename(file.originalname || "document");
    const id = makeId();
    cb(null, `${id}__${base}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

// --------------------------
// Auth admin
// --------------------------
const ADMIN_PASSWORD = String(process.env.GARANTIE_ADMIN_PASSWORD || "").trim();
const ADMIN_TOKEN = String(process.env.GARANTIE_ADMIN_TOKEN || "").trim(); // optional
const ADMIN_TOKEN_ALLOW_QUERY = parseBool(process.env.ADMIN_TOKEN_ALLOW_QUERY, true);

function extractAdminToken(req) {
  const headerToken = req.headers["x-admin-token"];
  if (headerToken) return String(headerToken).trim();

  const auth = req.headers.authorization;
  if (auth && String(auth).toLowerCase().startsWith("bearer ")) {
    return String(auth).slice(7).trim();
  }

  if (ADMIN_TOKEN_ALLOW_QUERY && req.query && req.query.token) {
    return String(req.query.token).trim();
  }

  return "";
}

function requireAdmin(req, res, next) {
  // If token configured, accept it
  if (ADMIN_TOKEN) {
    const tok = extractAdminToken(req);
    if (tok && tok === ADMIN_TOKEN) return next();
  }

  // Otherwise rely on session-like very simple header
  const pw = String(req.headers["x-admin-password"] || "").trim();
  if (pw && ADMIN_PASSWORD && pw === ADMIN_PASSWORD) return next();

  return res.status(401).json({ success: false, message: "unauthorized" });
}

// --------------------------
// Mailer
// --------------------------
function makeMailer() {
  const host = String(process.env.SMTP_HOST || "").trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASS || "").trim();
  const secure = parseBool(process.env.SMTP_SECURE, false);

  if (!host || !user || !pass) return null;

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
}

const transporter = makeMailer();

// Who gets notified per magasin (optional)
const RESP_SERVICE_BY_MAGASIN = jsonEnv("RESP_SERVICE_BY_MAGASIN_JSON", {});
const SITE_RESP_EMAIL = String(process.env.MAIL_CG || process.env.SITE_RESP_EMAIL || "").trim();
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || "").trim() || "https://www.documentsdurand.fr";

function respServiceEmailFor(magasin) {
  const m = String(magasin || "").trim().toUpperCase();
  return String(RESP_SERVICE_BY_MAGASIN[m] || "").trim();
}

async function sendMail({ to, subject, text, html, attachments }) {
  if (!transporter) return { ok: false, reason: "smtp_not_configured" };
  if (!to) return { ok: false, reason: "missing_to" };

  const from = String(process.env.MAIL_FROM || process.env.SMTP_FROM || transporter.options.auth.user || "").trim();
  const info = await transporter.sendMail({
    from,
    to,
    subject,
    text,
    html,
    attachments,
  });
  return { ok: true, info };
}

// --------------------------
// Routes
// --------------------------

// POST /demandes (public) - create a new demande with optional files
router.post("/demandes", upload.array("document", 12), async (req, res) => {
  try {
    const body = req.body || {};
    const files = Array.isArray(req.files) ? req.files : [];

    const id = makeId();
    const createdAt = nowIso();

    const demande = {
      id,
      createdAt,
      updatedAt: createdAt,
      statut: "enregistré",
      magasin: String(body.magasin || ""),
      nomClient: String(body.nomClient || ""),
      prenomClient: String(body.prenomClient || ""),
      emailClient: String(body.emailClient || ""),
      telephoneClient: String(body.telephoneClient || ""),
      reference: String(body.reference || ""),
      produit: String(body.produit || ""),
      prix: String(body.prix || ""),
      commentaire: String(body.commentaire || ""),
      documents: files.map(f => ({
        original: f.originalname,
        url: f.filename, // stored filename
        size: f.size,
        mimetype: f.mimetype,
      })),
      documentsAjoutes: [],
      historique: [{ at: createdAt, by: "system", action: "create" }],
    };

    const demandes = await loadDemandes();
    demandes.unshift(demande);
    await saveDemandes(demandes);

    // Emails (best effort)
    let mailClientOk = null;
    let mailMagasinOk = null;

    const confirmText =
      "Votre demande de Garantie a été envoyée avec succès.\n\nCordialement\nL'équipe Durand Services Garantie.";

    // client
    if (demande.emailClient) {
      try {
        const r = await sendMail({
          to: demande.emailClient,
          subject: "Confirmation de votre demande de garantie",
          text: confirmText,
        });
        mailClientOk = r.ok;
      } catch {
        mailClientOk = false;
      }
    }

    // magasin/responsable
    const toMag = respServiceEmailFor(demande.magasin) || SITE_RESP_EMAIL;
    if (toMag) {
      try {
        const linkAdmin = `${PUBLIC_BASE_URL}/garantie/admin`;
        const r = await sendMail({
          to: toMag,
          subject: `Nouvelle demande de garantie — ${demande.magasin || "magasin"}`,
          text:
            `Nouvelle demande enregistrée.\n\nID: ${id}\nClient: ${demande.prenomClient} ${demande.nomClient}\nMagasin: ${demande.magasin}\n\nAdmin: ${linkAdmin}\n`,
        });
        mailMagasinOk = r.ok;
      } catch {
        mailMagasinOk = false;
      }
    }

    return res.json({ success: true, id, mailClientOk, mailMagasinOk });
  } catch (e) {
    console.error("[GARANTIE] /demandes error:", e);
    return res.status(500).json({ success: false, message: "server_error" });
  }
});

// GET /mes-dossiers (public) - list (simple filter by email)
router.get("/mes-dossiers", async (req, res) => {
  const email = String(req.query.email || "").trim().toLowerCase();
  const id = String(req.query.id || "").trim();
  const demandes = await loadDemandes();
  const filtered = demandes.filter(d => {
    if (id && d.id === id) return true;
    if (email && String(d.emailClient || "").trim().toLowerCase() === email) return true;
    return false;
  });
  res.json({ success: true, data: filtered });
});

// GET /download/:file (public) - download an uploaded file
router.get("/download/:file", async (req, res) => {
  const file = String(req.params.file || "");
  const safe = path.basename(file);
  const abs = path.join(UPLOAD_DIR, safe);
  if (!fs.existsSync(abs)) return res.status(404).send("Not found");
  return res.download(abs, safe);
});

// GET /templates/:name (public) - supplier template PDFs
router.get("/templates/:name", async (req, res) => {
  const name = String(req.params.name || "");
  const safe = path.basename(name);
  const abs = path.join(TEMPLATES_DIR, safe);
  if (!fs.existsSync(abs)) return res.status(404).send("Not found");
  res.setHeader("Content-Type", "application/pdf");
  return fs.createReadStream(abs).pipe(res);
});

// --------------------------
// Admin
// --------------------------
router.post("/admin/login", express.json(), async (req, res) => {
  const password = String(req.body?.password || "").trim();
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ success: false, message: "admin_password_not_configured" });
  }
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, message: "Mot de passe incorrect." });
  }

  // flags kept for compatibility
  return res.json({
    success: true,
    isSuper: true,
    isAdmin: true,
    isLimited: false,
    magasin: null,
    multiMagasins: null,
    defaultMagasin: null,
  });
});

router.get("/admin/dossiers", requireAdmin, async (_req, res) => {
  const demandes = await loadDemandes();
  res.json({ success: true, data: demandes });
});

router.get("/admin/dossier/:id", requireAdmin, async (req, res) => {
  const id = String(req.params.id || "");
  const demandes = await loadDemandes();
  const found = demandes.find(d => d.id === id);
  if (!found) return res.status(404).json({ success: false, message: "not_found" });
  return res.json({ success: true, data: found });
});

router.post("/admin/completer-dossier/:id", requireAdmin, express.json(), async (req, res) => {
  const id = String(req.params.id || "");
  const patch = req.body || {};
  const demandes = await loadDemandes();
  const idx = demandes.findIndex(d => d.id === id);
  if (idx < 0) return res.status(404).json({ success: false, message: "not_found" });

  const d = demandes[idx];
  Object.assign(d, patch, { updatedAt: nowIso() });
  d.historique = Array.isArray(d.historique) ? d.historique : [];
  d.historique.unshift({ at: nowIso(), by: "admin", action: "update", patch });

  demandes[idx] = d;
  await saveDemandes(demandes);

  return res.json({ success: true });
});

router.post("/admin/envoyer-fournisseur/:id", requireAdmin, upload.single("file"), async (req, res) => {
  const id = String(req.params.id || "");
  const demandes = await loadDemandes();
  const idx = demandes.findIndex(d => d.id === id);
  if (idx < 0) return res.status(404).json({ success: false, message: "not_found" });

  const d = demandes[idx];
  d.updatedAt = nowIso();
  d.historique = Array.isArray(d.historique) ? d.historique : [];
  d.historique.unshift({ at: nowIso(), by: "admin", action: "envoyer_fournisseur" });

  await saveDemandes(demandes);
  return res.json({ success: true });
});

router.post("/admin/dossier/:id/delete-file", requireAdmin, express.json(), async (req, res) => {
  const id = String(req.params.id || "");
  const url = String(req.body?.url || "");
  const section = String(req.body?.section || "documentsAjoutes");

  const demandes = await loadDemandes();
  const idx = demandes.findIndex(d => d.id === id);
  if (idx < 0) return res.status(404).json({ success: false, message: "not_found" });

  const d = demandes[idx];
  const key = section === "documentsAjoutes" ? "documentsAjoutes" : "documents";

  d[key] = Array.isArray(d[key]) ? d[key] : [];
  d[key] = d[key].filter(f => String(f.url || "") !== url);

  d.updatedAt = nowIso();
  d.historique = Array.isArray(d.historique) ? d.historique : [];
  d.historique.unshift({ at: nowIso(), by: "admin", action: "delete_file", url, section });

  demandes[idx] = d;
  await saveDemandes(demandes);
  return res.json({ success: true });
});

router.get("/admin/export-excel", requireAdmin, async (_req, res) => {
  const demandes = await loadDemandes();

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Demandes");

  ws.columns = [
    { header: "ID", key: "id", width: 18 },
    { header: "Date", key: "createdAt", width: 22 },
    { header: "Statut", key: "statut", width: 14 },
    { header: "Magasin", key: "magasin", width: 18 },
    { header: "Nom", key: "nomClient", width: 18 },
    { header: "Prénom", key: "prenomClient", width: 18 },
    { header: "Email", key: "emailClient", width: 28 },
    { header: "Téléphone", key: "telephoneClient", width: 18 },
    { header: "Référence", key: "reference", width: 18 },
    { header: "Produit", key: "produit", width: 28 },
    { header: "Prix", key: "prix", width: 12 },
    { header: "Commentaire", key: "commentaire", width: 40 },
  ];

  demandes.forEach(d => ws.addRow(d));

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="demandes_garantie.xlsx"');

  await wb.xlsx.write(res);
  res.end();
});

export default router;
