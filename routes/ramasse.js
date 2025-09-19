// routes/ramasse.js
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import nodemailer from "nodemailer";
import mime from "mime-types";
import PDFDocument from "pdfkit";
import ftp from "basic-ftp";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const router = express.Router();

/* ===================== CONFIG / ENV ===================== */
const TMP_DIR = path.resolve(process.cwd(), "tmp");
fs.mkdirSync(TMP_DIR, { recursive: true });

// Secret HMAC pour signer le lien d’accusé
const RAMASSE_SECRET =
  process.env.RAMASSE_SECRET ||
  process.env.PRESENCES_LEAVES_PASSWORD ||
  process.env.LEAVES_PASS ||
  "change-me";

// chemins possibles pour les fichiers de config
const SUPPLIERS_PATHS = [
  path.resolve(__dirname, "suppliers.json"),
  path.resolve(__dirname, "../suppliers.json"),
];
const MAGASINS_PATHS = [
  path.resolve(__dirname, "magasins.json"),
  path.resolve(__dirname, "../magasins.json"),
];

// SMTP Gmail (utilisé seulement pour envoyer)
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: String(process.env.GMAIL_PASS || "").replace(/["\s]/g, ""),
  },
});

/* ===================== UPLOAD ===================== */
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, TMP_DIR),
    filename: (_req, file, cb) => {
      const ext  = path.extname(file.originalname) || ".bin";
      const base = path
        .basename(file.originalname, ext)
        .replace(/[^a-z0-9-_]+/gi, "_");
      cb(null, `${Date.now()}_${base}${ext}`);
    },
  }),
  limits: { fileSize: 24 * 1024 * 1024 },
});

/* ===================== HELPERS ===================== */
function loadJsonFrom(paths, fallback) {
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, "utf8");
        return JSON.parse(raw);
      }
    } catch {
      /* ignore */
    }
  }
  return fallback;
}

function loadSuppliers() {
  const arr = loadJsonFrom(SUPPLIERS_PATHS, []);
  return Array.isArray(arr) ? arr : [];
}

function loadMagasins() {
  const data = loadJsonFrom(MAGASINS_PATHS, []);
  if (Array.isArray(data) && data.length) {
    // accepte ["GLEIZE","MIRIBEL"] ou [{"name":"GLEIZE"}, ...]
    return Array.from(
      new Set(data.map(x => (typeof x === "string" ? x : (x?.name || ""))).filter(Boolean))
    );
  }
  // fallback éventuel si magasins.json absent
  const set = new Set();
  for (const s of loadSuppliers()) if (s.magasin) set.add(String(s.magasin));
  return Array.from(set);
}

function findSupplier(name) {
  const list = loadSuppliers();
  const n = String(name || "").trim().toLowerCase();
  return list.find(s => String(s.name || "").toLowerCase() === n);
}

function isValidEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || "").trim());
}
function uniqEmails(arr) {
  return Array.from(new Set((arr || []).map(x => String(x || "").trim()).filter(isValidEmail)));
}

function esc(t = "") {
  return String(t).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

/* ===== PDF : EXACTEMENT les champs du formulaire, ordre demandé ===== */
async function buildPdf({ fournisseur, magasinDest, email, pieces, commentaire }) {
  const safe = (s) => String(s || "").replace(/[^a-z0-9-_]+/gi, "_");
  const pdfPath = path.join(TMP_DIR, `Demande_Ramasse_${safe(fournisseur)}_${Date.now()}.pdf`);
  const doc = new PDFDocument({ size: "A4", margin: 56 });
  const stream = fs.createWriteStream(pdfPath);
  doc.pipe(stream);

  const blue = "#0f4c81";
  const gray = "#102a43";

  const pageLeft  = doc.page.margins.left;
  const pageRight = doc.page.width - doc.page.margins.right;

  // Logo
  try {
    const resp = await fetch("https://raw.githubusercontent.com/docudurand/mes-formulaires/main/logodurand.png");
    const buf = Buffer.from(await resp.arrayBuffer());
    doc.image(buf, pageLeft, 36, { width: 90 });
  } catch {
    /* ignore logo errors */
  }

  // Titre centré sur 2 lignes, sous le logo (pas de chevauchement)
  const titleY = 140; // > 36 + hauteur logo
  doc
    .font("Helvetica-Bold")
    .fillColor(blue)
    .fontSize(24)
    .text("Demande de\nramasse de pièces", pageLeft, titleY, {
      align: "center",
      width: pageRight - pageLeft,
      lineGap: 2,
    });

  doc.moveDown(3);

  // Bloc "Informations" (colonne gauche)
  const colGap = 24;
  const colW   = (pageRight - pageLeft - colGap) / 2;
  let y = doc.y;

  doc.fontSize(13).fillColor(blue).text("Informations", pageLeft, y);
  y = doc.y + 10;

  const labelW = 110;
  doc.fontSize(11).fillColor(gray).font("Helvetica-Bold").text("Fournisseur :", pageLeft, y, { width: labelW });
  doc.font("Helvetica").fillColor("#000").text(fournisseur || "—", pageLeft + labelW + 10, y, { width: colW - labelW - 10 });

  // Références (pleine largeur)
  doc.y = Math.max(doc.y, y) + 18;
  doc.font("Helvetica-Bold").fillColor(gray).text("Références :", pageLeft, doc.y);
  doc.moveDown(0.3);
  doc.font("Helvetica").fillColor("#000").text((pieces || "—"), { width: pageRight - pageLeft });

  // Destinataire(s) magasin — SOUS Références
  doc.moveDown(0.8);
  doc.font("Helvetica-Bold").fillColor(gray).text("Destinataire(s) magasin :", pageLeft, doc.y);
  doc.moveDown(0.2);
  doc.font("Helvetica").fillColor("#000").text(magasinDest || "—", { width: pageRight - pageLeft });

  // Commentaire (optionnel)
  if (commentaire && String(commentaire).trim()) {
    doc.moveDown(0.8);
    doc.font("Helvetica-Bold").fillColor(gray).text("Commentaire :", pageLeft, doc.y);
    doc.moveDown(0.2);
    doc.font("Helvetica").fillColor("#000").text(String(commentaire), { width: pageRight - pageLeft });
  }

  // Fin
  doc.end();
  return new Promise((resolve, reject) => {
    stream.on("finish", () => resolve(pdfPath));
    stream.on("error", reject);
  });
}

function buildMailHtml({ fournisseur, magasinDest, email, pieces, commentaire, ackUrl }) {
  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;line-height:1.45;color:#111">
    <p>Bonjour,</p>
    <p>Merci d'effectuer une <strong>ramasse</strong> chez <strong>${esc(fournisseur)}</strong> pour la/les référence(s) suivante(s) :<br/><em>${esc(pieces || "—")}</em>.</p>
    <p><strong>Destinataire(s) magasin :</strong> ${esc(magasinDest || "—")}<br/>
       <strong>Demandeur :</strong> ${esc(email)}</p>
    ${commentaire ? `<p><strong>Commentaire :</strong><br/>${esc(String(commentaire)).replace(/\n/g,"<br/>")}</p>` : ""}
    <p>
      <a href="${ackUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700">Accuser de réception</a>
    </p>
  </div>`;
}

function signAck(params) {
  const h = crypto.createHmac("sha256", RAMASSE_SECRET);
  const keys = Object.keys(params).sort();
  const base = keys.map((k) => `${k}=${params[k]}`).join("&");
  h.update(base);
  return h.digest("hex");
}

function buildAckUrl(req, payload) {
  const urlBase = `${req.protocol}://${req.get("host")}`;
  const qs = new URLSearchParams(payload);
  const sig = signAck(Object.fromEntries(qs));
  qs.set("sig", sig);
  return `${urlBase}/api/ramasse/ack?${qs.toString()}`;
}

async function ftpUpload(localPath, remoteDir) {
  if (!process.env.FTP_HOST || !process.env.FTP_USER) return;
  const client = new ftp.Client();
  client.ftp.verbose = false;
  try {
    await client.access({
      host: process.env.FTP_HOST,
      port: Number(process.env.FTP_PORT || 21),
      user: process.env.FTP_USER,
      password: process.env.FTP_PASSWORD,
      secure: String(process.env.FTP_SECURE || "false") === "true",
      secureOptions: { rejectUnauthorized: String(process.env.FTP_TLS_REJECT_UNAUTH || "1") !== "0" },
    });
    const root = (process.env.FTP_BACKUP_FOLDER || "/").replace(/\/$/, "");
    const targetDir = `${root}/${remoteDir}`.replace(/\/+/g, "/");
    await client.ensureDir(targetDir);
    const filename = path.basename(localPath);
    await client.uploadFrom(localPath, `${targetDir}/${filename}`);
  } catch (e) {
    console.error("[RAMASSE][FTP] upload error:", e.message);
  } finally {
    try { client.close(); } catch {}
  }
}

/* ===================== ROUTES ===================== */

// Fournisseurs (pour le select + info magasin en charge)
router.get("/fournisseurs", (_req, res) => {
  const out = loadSuppliers().map(({ name, magasin }) => ({ name, magasin }));
  res.json(out);
});

// Magasins destination indépendants
router.get("/magasins", (_req, res) => {
  res.json(loadMagasins());
});

// Dépôt demande — envoi UNIQUEMENT aux adresses du suppliers.json
router.post("/", upload.single("file"), async (req, res) => {
  try {
    const { fournisseur, magasin, email, pieces, commentaire, magasinDest } = req.body;
    if (!fournisseur || !email || !pieces) {
      return res.status(400).json({ error: "Champs requis manquants (fournisseur, email, pièces)." });
    }

    const sup = findSupplier(fournisseur);
    if (!sup) {
      return res.status(400).json({ error: "Fournisseur inconnu dans suppliers.json" });
    }

    const mg = sup?.magasin || magasin || "";
    const recipients = uniqEmails(sup?.recipients || []);
    const cc = uniqEmails(sup?.cc || []);

    if (!recipients.length) {
      return res.status(500).json({ error: "Aucun destinataire configuré pour ce fournisseur (suppliers.json)." });
    }

    // Lien d'accusé: envoi TOUJOURS (lien signé valable 14 jours)
    const ackPayload = {
      email: String(email),
      fournisseur: String(sup?.name || fournisseur),
      magasin: String(magasinDest || mg || ""),
      pieces: String(pieces || ""),
      ts: Date.now().toString(),
      nonce: crypto.randomBytes(8).toString("hex"),
    };
    const ackUrl = buildAckUrl(req, ackPayload);

    // PDF (champs du formulaire)
    const pdfPath = await buildPdf({
      fournisseur: sup?.name || fournisseur,
      magasinDest: magasinDest || mg,
      email,
      pieces,
      commentaire,
    });

    const subject = `Demande de ramasse – ${sup?.name || fournisseur}`;
    const html = buildMailHtml({
      fournisseur: sup?.name || fournisseur,
      magasinDest: magasinDest || mg,
      email,
      pieces,
      commentaire,
      ackUrl,
    });

    const attachments = [{ filename: path.basename(pdfPath), path: pdfPath, contentType: "application/pdf" }];
    if (req.file) {
      attachments.push({
        filename: req.file.originalname,
        path: req.file.path,
        contentType: req.file.mimetype || mime.lookup(req.file.originalname) || "application/octet-stream",
      });
    }

    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: recipients.join(", "),
      cc: cc.length ? cc.join(", ") : undefined,
      subject,
      html,
      attachments,
    });

    // archive PDF
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    await ftpUpload(pdfPath, `ramasse/${yyyy}/${mm}`);

    setTimeout(() => {
      try { fs.unlinkSync(pdfPath); } catch {}
      try { if (req.file) fs.unlinkSync(req.file.path); } catch {}
    }, 15_000);

    res.json({ ok: true });
  } catch (e) {
    console.error("[RAMASSE] POST error:", e);
    res.status(500).json({ error: "Échec de l'envoi. Vérifiez la config Gmail / PDF / FTP." });
  }
});

// Accusé direct — ENVOI À CHAQUE CLIC (pas de 'déjà confirmé')
router.get("/ack", async (req, res) => {
  try {
    const { email, fournisseur, magasin, pieces, ts, nonce, sig } = req.query;
    if (!email || !fournisseur || !ts || !nonce || !sig) return res.status(400).send("Lien incomplet");

    const params = {
      email: String(email),
      fournisseur: String(fournisseur),
      magasin: String(magasin || ""),
      pieces: String(pieces || ""),
      ts: String(ts),
      nonce: String(nonce),
    };

    const expected = signAck(params);
    const ok = (expected.length === String(sig).length)
      && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(sig)));
    if (!ok) return res.status(400).send("Signature invalide");

    // Validité 14 jours
    const age = Date.now() - Number(ts);
    if (isFinite(age) && age > 14 * 24 * 3600 * 1000) {
      return res.status(400).send("Lien expiré");
    }

    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: String(email),
      subject: `Accusé de réception – Demande de ramasse (${String(fournisseur)})`,
      html: `<p>Bonjour,<br/>Votre demande de ramasse pour <strong>${esc(fournisseur)}</strong> concernant <em>${esc(pieces || "—")}</em> a bien été prise en compte par le magasin <strong>${esc(magasin || "—")}</strong>.<br/><br/>Cordialement,<br/>L'équipe Ramasse</p>`,
    });

    res
      .status(200)
      .send(`<!doctype html><meta charset="utf-8"/><div style="font-family:system-ui;padding:24px">✅ Accusé de réception envoyé au demandeur.</div>`);
  } catch (e) {
    console.error("[RAMASSE] ACK error:", e);
    res.status(400).send("Lien invalide ou erreur d'envoi.");
  }
});

export default router;