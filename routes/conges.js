// routes/conges.js
import express from "express";
import path from "path";
import nodemailer from "nodemailer";
import { fileURLToPath } from "url";

const router = express.Router();

// --- LOG DIAG ---
router.use((req, _res, next) => {
  console.log("[CONGES] hit", req.method, req.originalUrl);
  next();
});

// __dirname (ESM)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ENV
const {
  MAIL_CG,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  FROM_EMAIL
} = process.env;

// Transport SMTP
const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: Number(SMTP_PORT || 587),
  secure: String(SMTP_PORT) === "465",
  auth: (SMTP_USER && SMTP_PASS) ? { user: SMTP_USER, pass: SMTP_PASS } : undefined
});

// --- DIAG: /conges/ping ---
router.get("/conges/ping", (_req, res) => res.status(200).send("pong"));

// --- PAGE: /conges ---
router.get("/conges", (_req, res) => {
  // Chemin ABSOLU robuste, quelque soit l’emplacement du router
  const htmlAbs = path.resolve("public", "conges", "index.html");
  res.sendFile(htmlAbs);
});

// --- API: /conges/api ---
router.post("/conges/api", async (req, res) => {
  try {
    const { magasin, nomPrenom, service, nbJours, dateDu, dateAu, email } = req.body || {};
    const errors = [];

    if (!magasin) errors.push("magasin");
    if (!nomPrenom) errors.push("nomPrenom");
    if (!service) errors.push("service");

    const n = Number(nbJours);
    if (!Number.isFinite(n) || n <= 0) errors.push("nbJours");

    const reMail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !reMail.test(String(email))) errors.push("email");

    const d1 = new Date(dateDu);
    const d2 = new Date(dateAu);
    if (!dateDu || !dateAu || isNaN(d1.getTime()) || isNaN(d2.getTime()) || d2 < d1) {
      errors.push("plageDates");
    }

    if (!MAIL_CG) errors.push("MAIL_CG_env");

    if (errors.length) {
      return res.status(400).json({ ok: false, error: "invalid_fields", fields: errors });
    }

    const subject = `Demande de congés - ${nomPrenom} - du ${dateDu} au ${dateAu}`;
    const html = `
      <h2>Demande de Jours de Congés</h2>
      <p><b>Magasin :</b> ${esc(magasin)}</p>
      <p><b>Nom & Prénom :</b> ${esc(nomPrenom)}</p>
      <p><b>Service :</b> ${esc(service)}</p>
      <p><b>Demande :</b> ${n} jour(s) de congés</p>
      <p><b>Période :</b> du ${esc(dateDu)} au ${esc(dateAu)}</p>
      <p><b>Email du demandeur :</b> ${esc(email)}</p>
      <hr>
      <p>Répondez à cet email pour répondre directement au demandeur (Reply-To).</p>
    `;

    await transporter.sendMail({
      to: MAIL_CG,
      from: FROM_EMAIL || SMTP_USER || "no-reply@localhost",
      replyTo: email,
      subject,
      html
    });

    res.json({ ok: true });
  } catch (e) {
    console.error("[CONGES][MAIL] Erreur:", e);
    res.status(500).json({ ok: false, error: "send_failed" });
  }
});

// utils
function esc(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export default router;
