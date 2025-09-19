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

const TMP_DIR = path.resolve(process.cwd(), "tmp");
fs.mkdirSync(TMP_DIR, { recursive: true });

const RAMASSE_SECRET =
  process.env.RAMASSE_SECRET ||
  process.env.PRESENCES_LEAVES_PASSWORD ||
  process.env.LEAVES_PASS ||
  "change-me";

const SUPPLIERS_PATHS = [
  path.resolve(__dirname, "suppliers.json"),
  path.resolve(__dirname, "../suppliers.json"),
];
const MAGASINS_PATHS = [
  path.resolve(__dirname, "magasins.json"),
  path.resolve(__dirname, "../magasins.json"),
];

const FALLBACK_TO = (process.env.DEST_EMAIL_FORMULAIRE_PIECE || "")
  .split(",").map(s => s.trim()).filter(Boolean);
const FALLBACK_CC = (process.env.MAIL_CG || "")
  .split(",").map(s => s.trim()).filter(Boolean);

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: process.env.GMAIL_USER, pass: String(process.env.GMAIL_PASS || "").replace(/["\s]/g, "") },
});

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

function loadJsonFrom(paths, fallback) {
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, "utf8");
        return JSON.parse(raw);
      }
    } catch {  }
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
    return Array.from(new Set(data.map(x => typeof x === "string" ? x : (x?.name || "")).filter(Boolean)));
  }

  const set = new Set();
  for (const s of loadSuppliers()) if (s.magasin) set.add(String(s.magasin));
  return Array.from(set);
}

function findSupplier(name) {
  const list = loadSuppliers();
  const n = String(name || "").trim().toLowerCase();
  return list.find(s => String(s.name || "").toLowerCase() === n);
}

function nowISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function escText(s="") {
  return String(s).replace(/\s+/g," ").trim();
}

async function buildPdf({ fournisseur, magasinDest, email, pieces, commentaire }) {
  const safe = (s) => String(s || "").replace(/[^a-z0-9-_]+/gi, "_");
  const pdfPath = path.join(TMP_DIR, `Demande_Ramasse_${safe(fournisseur)}_${Date.now()}.pdf`);
  const doc = new PDFDocument({ size: "A4", margin: 56 });
  const stream = fs.createWriteStream(pdfPath);
  doc.pipe(stream);

  const blue = "#0f4c81";
  const gray = "#102a43";

  const pageLeft = doc.page.margins.left;
  const pageRight = doc.page.width - doc.page.margins.right;

  try {
    const resp = await fetch("https://raw.githubusercontent.com/docudurand/mes-formulaires/main/logodurand.png");
    const buf = Buffer.from(await resp.arrayBuffer());
    doc.image(buf, pageLeft, 36, { width: 90 });
  } catch {}

  const headX = pageRight - 220;
  doc.font("Helvetica-Bold").fillColor(blue).fontSize(12)
     .text((magasinDest ? String(magasinDest).toUpperCase() : "DURAND"), headX, 40, { align: "right", width: 220 });
  const dossierNo = String(Date.now()).slice(-5).padStart(5, "0");
  doc.fillColor(gray).fontSize(11).text(`Dossier n° ${dossierNo}`, headX, 58, { align: "right", width: 220 });

  doc.moveDown(2.2).font("Helvetica-Bold").fillColor(blue).fontSize(22)
     .text("Demande de Ramasse", { align: "center" });
  doc.moveDown(1.2);

  const colGap = 24;
  const colW = (pageRight - pageLeft - colGap) / 2;
  let y = doc.y + 10;

  doc.fontSize(13).fillColor(blue).text("Informations client", pageLeft, y);
  y = doc.y + 10;

  doc.fontSize(11);
  doc.font("Helvetica-Bold").fillColor(gray).text("Nom du client :", pageLeft, y, { width: colW });
  doc.font("Helvetica").fillColor("#000").text(email ? email.split("@")[0] : "—", pageLeft + 120, y, { width: colW - 120 });
  y = doc.y + 6;

  doc.font("Helvetica-Bold").fillColor(gray).text("Email client :", pageLeft, y, { width: colW });
  doc.font("Helvetica").fillColor("#000").text(email || "—", pageLeft + 120, y, { width: colW - 120 });
  y = doc.y + 6;

  doc.font("Helvetica-Bold").fillColor(gray).text("Fournisseur :", pageLeft, y, { width: colW });
  doc.font("Helvetica").fillColor("#000").text(fournisseur || "—", pageLeft + 120, y, { width: colW - 120 });

  let yR = doc.page.margins.top + 140;
  const xR = pageLeft + colW + colGap;

  doc.font("Helvetica-Bold").fillColor(gray).text("Date de la demande :", xR, yR, { width: colW });
  doc.font("Helvetica").fillColor("#000").text(nowISO().split(" ")[0], xR + 160, yR, { width: colW - 160 });
  yR = doc.y + 6;

  doc.font("Helvetica-Bold").fillColor(gray).text("Destinataire(s) magasin :", xR, yR, { width: colW });
  doc.font("Helvetica").fillColor("#000").text(magasinDest || "—", xR + 180, yR, { width: colW - 180 });
  yR = doc.y + 6;

  doc.y = Math.max(y, yR) + 18;

  doc.fontSize(11).font("Helvetica-Bold").fillColor(gray).text("Références à récupérer :", pageLeft, doc.y);
  doc.moveDown(0.3);
  doc.font("Helvetica").fillColor("#000").text(escText(pieces || "—"), { width: pageRight - pageLeft });
  doc.moveDown(0.8);

  doc.font("Helvetica-Bold").fillColor(gray).text("Commentaire :", pageLeft, doc.y);
  doc.moveDown(0.3);
  doc.font("Helvetica").fillColor("#000").text(commentaire ? String(commentaire) : "—", { width: pageRight - pageLeft });

  doc.fontSize(9).fillColor("#6b778d")
     .text("Document généré automatiquement – Durand, pièces automobile et services",
           pageLeft, doc.page.height - 52, { align: "left" });

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
    <p>Merci d'effectuer une <strong>ramasse</strong> chez <strong>${(fournisseur)}</strong> pour la/les référence(s) suivante(s) :<br/><em>${(pieces || "—")}</em>.</p>
    <p><strong>Destinataire(s) magasin :</strong> ${(magasinDest || "—")}<br/>
       <strong>Demandeur :</strong> ${(email)}</p>
    ${commentaire ? `<p><strong>Commentaire :</strong><br/>${String(commentaire).replace(/\n/g,"<br/>")}</p>` : ""}
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

const ACK_DIR = "ramasse/acks";
const ACK_TTL_MS = 14 * 24 * 3600 * 1000;

function ackKey(params) {
  return signAck(params);
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
    await client.ensureDir(dir);
    const file = `${dir}/${key}.txt`;
    try { await client.size(file); return true; } catch {}
    const tmp = path.join(TMP_DIR, `ack_${key}.txt`);
    fs.writeFileSync(tmp, `ack-used ${new Date().toISOString()}\n`);
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

const USED_ACK_MEMORY = new Map();

function isAckUsedInMemory(key) {
  const ts = USED_ACK_MEMORY.get(key);
  if (!ts) return false;
  if (Date.now() - ts > ACK_TTL_MS) { USED_ACK_MEMORY.delete(key); return false; }
  return true;
}

function markAckUsedInMemory(key) {
  USED_ACK_MEMORY.set(key, Date.now());
}

router.get("/fournisseurs", (_req, res) => {
  const out = loadSuppliers().map(({ name, magasin }) => ({ name, magasin }));
  res.json(out);
});

router.get("/magasins", (_req, res) => {
  res.json(loadMagasins());
});

router.post("/", upload.single("file"), async (req, res) => {
  try {
    const { fournisseur, magasin, email, pieces, commentaire, magasinDest } = req.body;
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

    const ackPayload = {
      email: String(email),
      fournisseur: String(sup?.name || fournisseur),
      magasin: String(magasinDest || mg || ""),
      pieces: String(pieces || ""),
      ts: Date.now().toString(),
      nonce: crypto.randomBytes(8).toString("hex"),
    };
    const ackUrl = buildAckUrl(req, ackPayload);

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
    res.status(500).json({ error: "Échec de l'envoi. Vérifiez la config Gmail / FTP." });
  }
});

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
    const h1 = Buffer.from(sig);
    const h2 = Buffer.from(signAck(params));
    if (h1.length !== h2.length || !crypto.timingSafeEqual(h1, h2)) {
      return res.status(400).send("Signature invalide");
    }

    const age = Date.now() - Number(ts);
    if (isFinite(age) && age > ACK_TTL_MS) {
      return res.status(400).send("Lien expiré");
    }

    const key = ackKey(params);

    if (isAckUsedInMemory(key) || await markAckUsedOnFTP(key)) {
      if (!isAckUsedInMemory(key)) markAckUsedInMemory(key);
      return res.status(200).send(`<!doctype html><meta charset="utf-8"/><div style="font-family:system-ui;padding:24px">ℹ️ Accusé déjà confirmé.</div>`);
    }

    markAckUsedInMemory(key);
    await markAckUsedOnFTP(key);

    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: String(email),
      subject: `Accusé de réception – Demande de ramasse (${String(fournisseur)})`,
      html: `<p>Bonjour,<br/>Votre demande de ramasse pour <strong>${String(fournisseur)}</strong> concernant <em>${String(pieces || "—")}</em> a bien été prise en compte par le magasin <strong>${String(magasin || "—")}</strong>.<br/><br/>Cordialement,<br/>L'équipe Ramasse</p>`,
    });

    res.status(200).send(`<!doctype html><meta charset="utf-8"/><div style="font-family:system-ui;padding:24px">✅ Accusé de réception envoyé au demandeur.</div>`);
  } catch (e) {
    console.error("[RAMASSE] ACK error:", e);
    res.status(400).send("Lien invalide ou erreur d'envoi.");
  }
});

export default router;