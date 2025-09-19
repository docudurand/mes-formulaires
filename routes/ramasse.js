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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();

const TMP_DIR = path.resolve(process.cwd(), "tmp");
fs.mkdirSync(TMP_DIR, { recursive: true });

const RAMASSE_SECRET =
  process.env.RAMASSE_SECRET ||
  process.env.PRESENCES_LEAVES_PASSWORD ||
  process.env.LEAVES_PASS ||
  "change-me";

const SUPPLIERS_PATH = path.resolve(__dirname, "../suppliers.json");

const FALLBACK_TO = (process.env.DEST_EMAIL_FORMULAIRE_PIECE || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const FALLBACK_CC = (process.env.MAIL_CG || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, TMP_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || ".bin";
      const base = path
        .basename(file.originalname, ext)
        .replace(/[^a-z0-9-_]+/gi, "_");
      cb(null, `${Date.now()}_${base}${ext}`);
    },
  }),
  limits: { fileSize: 24 * 1024 * 1024 },
});

function loadSuppliers() {
  try {
    const raw = fs.readFileSync(SUPPLIERS_PATH, "utf8");
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function findSupplier(name) {
  const list = loadSuppliers();
  const n = String(name || "").trim().toLowerCase();
  return list.find((s) => String(s.name || "").toLowerCase() === n);
}

function nowISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours()
  )}:${p(d.getMinutes())}`;
}

function buildPdf({ fournisseur, magasin, email, pieces, commentaire }) {
  const safe = (s) => String(s || "").replace(/[^a-z0-9-_]+/gi, "_");
  const pdfPath = path.join(
    TMP_DIR,
    `Demande_Ramasse_${safe(fournisseur)}_${Date.now()}.pdf`
  );
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
  return String(s || "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function buildMailHtml({ fournisseur, magasin, email, pieces, commentaire, ackUrl }) {
  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;line-height:1.45;color:#111">
    <p>Bonjour,</p>
    <p>Merci d'effectuer une <strong>ramasse</strong> chez <strong>${esc(
      fournisseur
    )}</strong> pour la/les référence(s) suivante(s) :<br/><em>${esc(
    pieces || "—"
  )}</em>.</p>
    <p><strong>Magasin en charge :</strong> ${esc(magasin || "—")}<br/>
       <strong>Demandeur :</strong> ${esc(email)}</p>
    ${commentaire ? `<p><strong>Commentaire :</strong><br/>${esc(commentaire).replace(/\n/g, "<br/>")}</p>` : ""}
    <p>
      <a href="${ackUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700">
        Accuser de réception
      </a>
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
  const query = new URLSearchParams(payload);
  const sig = signAck(Object.fromEntries(query));
  query.set("sig", sig);
  return `${urlBase}/api/ramasse/ack?${query.toString()}`;
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
      secureOptions: {
        rejectUnauthorized:
          String(process.env.FTP_TLS_REJECT_UNAUTH || "1") !== "0",
      },
    });
    const root = (process.env.FTP_BACKUP_FOLDER || "/").replace(/\/$/, "");
    const targetDir = `${root}/${remoteDir}`.replace(/\/+/g, "/");

    const parts = targetDir.split("/").filter(Boolean);
    let cur = "";
    for (const p of parts) {
      cur += `/${p}`;
      try {
        await client.ensureDir(cur);
      } catch {}
    }

    const filename = path.basename(localPath);
    await client.uploadFrom(localPath, `${targetDir}/${filename}`);
  } catch (e) {
    console.error("FTP upload error:", e.message);
  } finally {
    client.close();
  }
}

router.get("/fournisseurs", (req, res) => {
  const out = loadSuppliers().map(({ name, magasin }) => ({ name, magasin }));
  res.json(out);
});

router.post("/", upload.single("file"), async (req, res) => {
  try {
    const { fournisseur, magasin, email, pieces, commentaire } = req.body;

    if (!fournisseur || !email || !pieces) {
      return res
        .status(400)
        .json({ error: "Champs requis manquants (fournisseur, email, pièces)." });
    }

    const sup = findSupplier(fournisseur);
    const mg = sup?.magasin || magasin || "";
    const recipients = (sup?.recipients || []).filter(Boolean);
    const cc = (sup?.cc || []).filter(Boolean);

    const toList =
      recipients.length > 0 ? recipients : FALLBACK_TO /* fallback */;
    const ccList = cc.length > 0 ? cc : FALLBACK_CC;

    if (toList.length === 0) {
      return res
        .status(500)
        .json({ error: "Aucun destinataire configuré pour ce fournisseur." });
    }

    const ackPayload = {
      email: email,
      fournisseur: sup?.name || fournisseur,
      magasin: mg,
      pieces: pieces,
      ts: Date.now().toString(),
    };
    const ackUrl = buildAckUrl(req, ackPayload);

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
      {
        filename: path.basename(pdfPath),
        path: pdfPath,
        contentType: "application/pdf",
      },
    ];
    if (req.file) {
      attachments.push({
        filename: req.file.originalname,
        path: req.file.path,
        contentType:
          req.file.mimetype ||
          mime.lookup(req.file.originalname) ||
          "application/octet-stream",
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
      try {
        fs.unlinkSync(pdfPath);
      } catch {}
      try {
        if (req.file) fs.unlinkSync(req.file.path);
      } catch {}
    }, 15_000);

    res.json({ ok: true });
  } catch (e) {
    console.error("ramasse POST error:", e);
    res.status(500).json({ error: "Échec de l'envoi. Vérifiez la config Gmail / FTP." });
  }
});

router.get("/ack", async (req, res) => {
  try {
    const { email, fournisseur, magasin, pieces, ts, sig } = req.query;
    if (!email || !fournisseur || !ts || !sig)
      return res.status(400).send("Lien incomplet");

    const params = { email: String(email), fournisseur: String(fournisseur), magasin: String(magasin||""), pieces: String(pieces||""), ts: String(ts) };
    const expect = signAck(params);
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) {
      return res.status(400).send("Signature invalide");
    }

    const age = Date.now() - Number(ts);
    if (isFinite(age) && age > 14 * 24 * 3600 * 1000) {
      return res.status(400).send("Lien expiré");
    }

    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: String(email),
      subject: `Accusé de réception – Demande de ramasse (${String(fournisseur)})`,
      html: `<p>Bonjour,<br/>Votre demande de ramasse pour <strong>${esc(
        fournisseur
      )}</strong> concernant <em>${esc(
        pieces || "—"
      )}</em> a bien été prise en compte par le magasin <strong>${esc(
        magasin || "—"
      )}</strong>.<br/><br/>Cordialement,<br/>L'équipe Ramasse</p>`,
    });

    res
      .status(200)
      .send(
        `<!doctype html><meta charset="utf-8"/><title>Accusé enregistré</title><div style="font-family:system-ui;padding:24px">✅ Accusé de réception envoyé au demandeur.</div>`
      );
  } catch (e) {
    console.error("ramasse ACK error:", e);
    res.status(400).send("Lien invalide ou erreur d'envoi.");
  }
});

export default router;