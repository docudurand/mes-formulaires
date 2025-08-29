import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import nodemailer from "nodemailer";

import * as stats from "./stats.js";

import formtelevente from "./formtelevente/index.js";
import formulairePiece from "./formulaire-piece/index.js";
import formulairePiecePL from "./formulaire-piecepl/index.js";
import formulairePneu from "./formulaire-pneu/index.js";
import suiviDossier from "./suivi-dossier/index.js";
import loansRouter from "./pretvehiculed/server-loans.js";

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.set("trust proxy", 1);

app.use(cors());
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

app.use(
  express.static(path.join(__dirname, "public"), {
    extensions: ["html", "htm"],
    index: false,
  })
);

console.log("[BOOT] public/conges existe ?",
  fs.existsSync(path.join(__dirname, "public", "conges")));
console.log("[BOOT] public/conges/index.html existe ?",
  fs.existsSync(path.join(__dirname, "public", "conges", "index.html")));

app.get("/conges/ping", (_req, res) => {
  console.log("[CONGES] GET /conges/ping");
  res.status(200).send("pong");
});

app.get("/conges", (_req, res) => {
  const htmlAbs = path.join(__dirname, "public", "conges", "index.html");
  console.log("[CONGES] GET /conges ->", htmlAbs);
  res.sendFile(htmlAbs);
});

app.post("/conges/api", async (req, res) => {
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

    const { MAIL_CG, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, FROM_EMAIL } = process.env;
    if (!MAIL_CG) errors.push("MAIL_CG_env");

    if (errors.length) {
      console.warn("[CONGES] invalid_fields:", errors);
      return res.status(400).json({ ok: false, error: "invalid_fields", fields: errors });
    }

    const { MAIL_CG, GMAIL_USER, GMAIL_PASS, FROM_EMAIL } = process.env;

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: GMAIL_USER,
    pass: GMAIL_PASS.replace(/"/g, "").replace(/\s/g, "")
  }
});

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

    console.log("[CONGES] email envoyé à", MAIL_CG, "reply-to", email);
    res.json({ ok: true });
  } catch (e) {
    console.error("[CONGES][MAIL] Erreur:", e);
    res.status(500).json({ ok: false, error: "send_failed" });
  }
});

app.get("/healthz", (_req, res) => res.sendStatus(200));

app.get("/", (_req, res) => {
  res.status(200).send("📝 Mes Formulaires – service opérationnel");
});

app.use("/formtelevente", formtelevente);
app.use("/formulaire-piece", formulairePiece);
app.use("/formulaire-piecepl", formulairePiecePL);
app.use("/formulaire-pneu", formulairePneu);
app.use("/suivi-dossier", suiviDossier);

const pretPublic = path.join(__dirname, "pretvehiculed", "public");
app.use(
  "/pret",
  express.static(pretPublic, { extensions: ["html", "htm"], index: false })
);
app.get("/pret/fiche", (_req, res) => {
  res.sendFile(path.join(pretPublic, "fiche-pret.html"));
});
app.get("/pret/admin", (_req, res) => {
  res.sendFile(path.join(pretPublic, "admin-parc.html"));
});
app.use("/pret/api", loansRouter);

app.use((req, res, next) => {
  const url = req.originalUrl || req.url || "";
  const method = req.method;

  res.on("finish", async () => {
    try {
      const success = res.statusCode >= 200 && res.statusCode < 300;
      if (!success || method !== "POST") return;

      if (url.startsWith("/formulaire-piece")) {
        console.log("[COMPTEUR] POST OK sur", url, "-> piece +1");
        await stats.recordSubmission("piece");
      } else if (url.startsWith("/formulaire-piecepl")) {
        console.log("[COMPTEUR] POST OK sur", url, "-> piecepl +1");
        await stats.recordSubmission("piecepl");
      } else if (url.startsWith("/formulaire-pneu")) {
        console.log("[COMPTEUR] POST OK sur", url, "-> pneu +1");
        await stats.recordSubmission("pneu");
      }
    } catch (e) {
      console.warn("[COMPTEUR] post-hook erreur:", e?.message || e);
    }
  });

  next();
});

app.use((_req, res) => res.status(404).json({ error: "Not Found" }));

const PORT = process.env.PORT || 3000;
(async () => {
  try {
    await stats.initCounters();
  } catch (e) {
    console.warn("[COMPTEUR] initCounters souci:", e?.message || e);
  }
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
})();

function esc(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}