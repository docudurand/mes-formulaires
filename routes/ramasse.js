
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

// chemins possibles pour suppliers.json (selon ton repo)
const SUPPLIERS_PATHS = [
  path.resolve(__dirname, "suppliers.json"),
  path.resolve(__dirname, "../suppliers.json"),
];

const FALLBACK_TO = (process.env.DEST_EMAIL_FORMULAIRE_PIECE || "")
  .split(",").map(s => s.trim()).filter(Boolean);
const FALLBACK_CC = (process.env.MAIL_CG || "")
  .split(",").map(s => s.trim()).filter(Boolean);

// SMTP Gmail (utilise déjà ton GMAIL_USER/PASS)
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: process.env.GMAIL_USER, pass: String(process.env.GMAIL_PASS || "").replace(/["\s]/g, "") },
});

// Upload (24 Mo)
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, TMP_DIR),
    filename: (_req, file, cb) => {
      const ext  = path.extname(file.originalname) || ".bin";
      const base = path.basename(file.originalname, ext).replace(/[^a-z0-9-_]+/gi, "_");
      cb(null, `${Date.now()}_${base}${ext}`);
    },
  }),
  limits: { fileSize: 24 * 1024 * 1024 },
});

/* ===================== HELPERS ===================== */
function loadSuppliers() {
  for (const p of SUPPLIERS_PATHS) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, "utf8");
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return arr;
      }
    } catch {}
  }
  return [];
}

function findSupplier(name) {
  const list = loadSuppliers();
  const n = String(name || "").trim().toLowerCase();
  return list.find(s => String(s.name || "").toLowerCase() === n);
}

function nowISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function buildPdf({ fournisseur, magasin, email, pieces, commentaire }) {
  const safe = (s) => String(s || "").replace(/[^a-z0-9-_]+/gi, "_");
  const pdfPath = path.join(TMP_DIR, `Demande_Ramasse_${safe(fournisseur)}_${Date.now()}.pdf`);
  const doc = new PDFDocument({ size: "A4", margin: 48 });
  const stream = fs.createWriteStream(pdfPath);
  doc.pipe(stream);

  doc.fontSize(18).text("Demande de ramasse de pièces");
  doc.moveDown(0.5);
  doc.fontSize(12).text(`Date : ${nowISO()}`);
  doc.text(`Fournisseur : ${fournisseur}`);
  doc.text(`Magasin en charge : ${magasin || "—"}`);
  doc.text(`Demandeur : ${email}`);
  doc.moveDown();
  doc.font("Helvetica-Bold").text("Références");
  doc.font("Helvetica").text(pieces || "—");
  doc.moveDown();
  doc.font("Helvetica-Bold").text("Commentaire");
  doc.font("Helvetica").text(commentaire || "—");

  doc.end();
  return new Promise((resolve, reject) => {
    stream.on("finish", () => resolve(pdfPath));
    stream.on("error", reject);
  });
}

function esc(s) {
  return String(s || "").replace(/[&<>\"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function buildMailHtml({ fournisseur, magasin, email, pieces, commentaire, ackUrl }) {
  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;line-height:1.45;color:#111">
    <p>Bonjour,</p>
    <p>Merci d'effectuer une <strong>ramasse</strong> chez <strong>${esc(fournisseur)}</strong> pour la/les référence(s) suivante(s) :<br/><em>${esc(pieces || "—")}</em>.</p>
    <p><strong>Magasin en charge :</strong> ${esc(magasin || "—")}<br/>
       <strong>Demandeur :</strong> ${esc(email)}</p>
    ${commentaire ? `<p><strong>Commentaire :</strong><br/>${esc(commentaire).replace(/\\n/g,"<br/>")}</p>` : ""}
    <p>
      <a href="${ackUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700">Accuser de réception</a>
    </p>
    <p style="color:#666;font-size:12px">Le bouton ci-dessus enverra automatiquement un accusé au demandeur.</p>
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

/* ====== Idempotence pour l'accusé: mémoire + FTP ====== */
const ACK_DIR = "ramasse/acks";
const ACK_TTL_MS = 14 * 24 * 3600 * 1000;

function ackKey(params) {
  // utilise la signature comme clé unique
  return signAck(params);
}

async function ftpEnsure(client, dir) {
  try { await client.ensureDir(dir); } catch {}
}

async function ftpExists(client, remotePath) {
  try { await client.size(remotePath); return true; } catch { return false; }
}

async function markAckUsedOnFTP(key) {
  if (!process.env.FTP_HOST || !process.env.FTP_USER) return false;
  const client = new ftp.Client();
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
    const dir = `${root}/${ACK_DIR}`.replace(/\/+/g, "/");
    await ftpEnsure(client, dir);
    const file = `${dir}/${key}.txt`;
    const exists = await ftpExists(client, file);
    if (exists) return true; // déjà utilisé

    const tmp = path.join(TMP_DIR, `ack_${key}.txt`);
    fs.writeFileSync(tmp, `ack-used ${new Date().toISOString()}\\n`);
    await client.uploadFrom(tmp, file);
    try { fs.unlinkSync(tmp); } catch {}
    return false;
  } catch (e) {
    console.warn("[RAMASSE][ACK] FTP mark failed:", e?.message || e);
    return false;
  } finally {
    try { client.close(); } catch {}
  }
}

const USED_ACK_MEMORY = new Map(); // key -> ts

function isAckUsedInMemory(key) {
  const ts = USED_ACK_MEMORY.get(key);
  if (!ts) return false;
  if (Date.now() - ts > ACK_TTL_MS) { USED_ACK_MEMORY.delete(key); return false; }
  return true;
}

function markAckUsedInMemory(key) {
  USED_ACK_MEMORY.set(key, Date.now());
}

/* ===================== ROUTES ===================== */

// Liste fournisseurs
router.get("/fournisseurs", (_req, res) => {
  const out = loadSuppliers().map(({ name, magasin }) => ({ name, magasin }));
  res.json(out);
});

// Dépôt demande
router.post("/", upload.single("file"), async (req, res) => {
  try {
    const { fournisseur, magasin, email, pieces, commentaire } = req.body;
    if (!fournisseur || !email || !pieces) {
      return res.status(400).json({ error: "Champs requis manquants (fournisseur, email, pièces)." });
    }

    const sup = findSupplier(fournisseur);
    const mg = sup?.magasin || magasin || "";
    const recipients = (sup?.recipients || []).filter(Boolean);
    const cc = (sup?.cc || []).filter(Boolean);

    const toList = recipients.length ? recipients : FALLBACK_TO;
    const ccList = cc.length ? cc : FALLBACK_CC;

    if (!toList.length) {
      return res.status(500).json({ error: "Aucun destinataire configuré pour ce fournisseur." });
    }

    // Lien d'accusé: inclut un nonce + ts, confirmé ensuite par POST
    const ackPayload = {
      email: String(email),
      fournisseur: String(sup?.name || fournisseur),
      magasin: String(mg || ""),
      pieces: String(pieces || ""),
      ts: Date.now().toString(),
      nonce: crypto.randomBytes(8).toString("hex"),
    };
    const ackUrl = buildAckUrl(req, ackPayload);

    // PDF récap
    const pdfPath = await buildPdf({
      fournisseur: sup?.name || fournisseur,
      magasin: mg,
      email,
      pieces,
      commentaire,
    });

    const subject = `Demande de ramasse – ${sup?.name || fournisseur}`;
    const html = buildMailHtml({
      fournisseur: sup?.name || fournisseur,
      magasin: mg,
      email,
      pieces,
      commentaire,
      ackUrl,
    });

    const attachments = [
      { filename: path.basename(pdfPath), path: pdfPath, contentType: "application/pdf" },
    ];
    if (req.file) {
      attachments.push({
        filename: req.file.originalname,
        path: req.file.path,
        contentType: req.file.mimetype || mime.lookup(req.file.originalname) || "application/octet-stream",
      });
    }

    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: toList.join(", "),
      cc: ccList.length ? ccList.join(", ") : undefined,
      subject,
      html,
      attachments,
    });

    // Option: archive PDF sur FTP (année/mois)
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    await ftpUpload(pdfPath, `ramasse/${yyyy}/${mm}`);

    // nettoyage fichiers temporaires
    setTimeout(() => {
      try { fs.unlinkSync(pdfPath); } catch {}
      try { if (req.file) fs.unlinkSync(req.file.path); } catch {}
    }, 15_000);

    res.json({ ok: true });
  } catch (e) {
    console.error("[RAMASSE] POST error:", e);
    res.status(500).json({ error: "Échec de l'envoi. Vérifiez la config Gmail / FTP." });
  }
});

// Page de confirmation (GET) — ne déclenche pas l’envoi
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
    const expect = signAck(params);
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) {
      return res.status(400).send("Signature invalide");
    }

    // âge max (14 jours)
    const age = Date.now() - Number(ts);
    if (isFinite(age) && age > ACK_TTL_MS) {
      return res.status(400).send("Lien expiré");
    }

    // page de confirmation
    const html = `
<!doctype html><meta charset="utf-8"/>
<title>Confirmer l'accusé de réception</title>
<div style="font-family:system-ui;max-width:640px;margin:40px auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px">
  <h2>Confirmer l'accusé de réception</h2>
  <p>Fournisseur : <b>${esc(fournisseur)}</b></p>
  <p>Références : <em>${esc(pieces || "—")}</em></p>
  <form method="post" action="/api/ramasse/ack/confirm">
    <input type="hidden" name="email" value="${esc(email)}"/>
    <input type="hidden" name="fournisseur" value="${esc(fournisseur)}"/>
    <input type="hidden" name="magasin" value="${esc(magasin || "")}"/>
    <input type="hidden" name="pieces" value="${esc(pieces || "")}"/>
    <input type="hidden" name="ts" value="${esc(ts)}"/>
    <input type="hidden" name="nonce" value="${esc(nonce)}"/>
    <input type="hidden" name="sig" value="${esc(sig)}"/>
    <button type="submit" style="background:#2563eb;color:#fff;border:0;border-radius:8px;padding:10px 16px;cursor:pointer">Confirmer</button>
  </form>
  <p style="color:#666;font-size:12px;margin-top:12px">Cette étape empêche les envois automatiques déclenchés par certains webmails.</p>
</div>`;
    res.status(200).send(html);
  } catch (e) {
    console.error("[RAMASSE] ACK view error:", e);
    res.status(400).send("Lien invalide.");
  }
});

// Confirmation (POST) — envoie l’accusé si pas déjà utilisé
router.post("/ack/confirm", express.urlencoded({ extended: true }), async (req, res) => {
  try {
    const { email, fournisseur, magasin, pieces, ts, nonce, sig } = req.body || {};
    if (!email || !fournisseur || !ts || !nonce || !sig) return res.status(400).send("Requête incomplète");

    const params = {
      email: String(email),
      fournisseur: String(fournisseur),
      magasin: String(magasin || ""),
      pieces: String(pieces || ""),
      ts: String(ts),
      nonce: String(nonce),
    };
    const key = ackKey(params);
    const expect = signAck(params);
    if (sig !== expect) return res.status(400).send("Signature invalide");

    // idempotence
    if (isAckUsedInMemory(key)) {
      return res.status(200).send(`<!doctype html><meta charset="utf-8"/><div style="font-family:system-ui;padding:24px">ℹ️ Accusé déjà confirmé.</div>`);
    }
    const alreadyOnFTP = await markAckUsedOnFTP(key);
    if (alreadyOnFTP) {
      markAckUsedInMemory(key);
      return res.status(200).send(`<!doctype html><meta charset="utf-8"/><div style="font-family:system-ui;padding:24px">ℹ️ Accusé déjà confirmé.</div>`);
    }
    markAckUsedInMemory(key);

    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: String(email),
      subject: `Accusé de réception – Demande de ramasse (${String(fournisseur)})`,
      html: `<p>Bonjour,<br/>Votre demande de ramasse pour <strong>${esc(fournisseur)}</strong> concernant <em>${esc(pieces || "—")}</em> a bien été prise en compte par le magasin <strong>${esc(magasin || "—")}</strong>.<br/><br/>Cordialement,<br/>L'équipe Ramasse</p>`,
    });

    res.status(200).send(`<!doctype html><meta charset="utf-8"/><div style="font-family:system-ui;padding:24px">✅ Accusé de réception envoyé au demandeur.</div>`);
  } catch (e) {
    console.error("[RAMASSE] ACK confirm error:", e);
    res.status(400).send("Erreur lors de l'envoi de l'accusé.");
  }
});

export default router;
