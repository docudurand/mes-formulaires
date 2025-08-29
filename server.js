import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import nodemailer from "nodemailer";
import PDFDocument from "pdfkit";

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

console.log("[BOOT] public/conges ?",
  fs.existsSync(path.join(__dirname, "public", "conges")));
console.log("[BOOT] public/conges/index.html ?",
  fs.existsSync(path.join(__dirname, "public", "conges", "index.html")));

app.get("/conges/ping", (_req, res) => res.status(200).send("pong"));

app.get("/conges", (_req, res) => {
  const htmlAbs = path.join(__dirname, "public", "conges", "index.html");
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

    const { MAIL_CG, GMAIL_USER, GMAIL_PASS, FROM_EMAIL } = process.env;
    if (!MAIL_CG || !GMAIL_USER || !GMAIL_PASS) {
      console.warn("[CONGES] smtp_not_configured:", { MAIL_CG: !!MAIL_CG, GMAIL_USER: !!GMAIL_USER, GMAIL_PASS: !!GMAIL_PASS });
      return res.status(500).json({ ok: false, error: "smtp_not_configured" });
    }

    const cleanedPass = String(GMAIL_PASS).replace(/["\s]/g, "");
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: GMAIL_USER, pass: cleanedPass },
    });

    const duFR = fmtFR(dateDu);
    const auFR = fmtFR(dateAu);

    const pdfBuffer = await makeLeavePdf({
      logoUrl: "https://raw.githubusercontent.com/docudurand/mes-formulaires/main/logodurand.png",
      magasin,
      nomPrenom,
      service,
      nbJours: n,
      du: duFR,
      au: auFR,
    });

    const subject = `Demande - ${nomPrenom}`;
    const html = `
      <h2>Demande de Jours de Congés</h2>
      <p><b>Magasin :</b> ${esc(magasin)}</p>
      <p><b>Nom & Prénom :</b> ${esc(nomPrenom)}</p>
      <p><b>Service :</b> ${esc(service)}</p>
      <p><b>Demande :</b> ${n} jour(s) de congés</p>
      <p><b>Période :</b> du ${esc(duFR)} au ${esc(auFR)}</p>
      <p><b>Email du demandeur :</b> ${esc(email)}</p>
    `;

    await transporter.sendMail({
      to: MAIL_CG,
      from: `Demande jours de congés <${FROM_EMAIL || GMAIL_USER || "no-reply@localhost"}>`,
      replyTo: email,
      subject,
      html,
      attachments: [
        {
          filename: `Demande-conges-${nomPrenom.replace(/[^\w.-]+/g, "_")}.pdf`,
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    });

    console.log("[CONGES] email envoyé à", MAIL_CG, "reply-to", email);
    res.json({ ok: true });
  } catch (e) {
    console.error("[CONGES][MAIL] Erreur:", e);
    res.status(500).json({ ok: false, error: "send_failed" });
  }
});

app.get("/healthz", (_req, res) => res.sendStatus(200));
app.get("/", (_req, res) => res.status(200).send("📝 Mes Formulaires – service opérationnel"));

app.use("/formtelevente", formtelevente);
app.use("/formulaire-piece", formulairePiece);
app.use("/formulaire-piecepl", formulairePiecePL);
app.use("/formulaire-pneu", formulairePneu);
app.use("/suivi-dossier", suiviDossier);

const pretPublic = path.join(__dirname, "pretvehiculed", "public");
app.use("/pret", express.static(pretPublic, { extensions: ["html", "htm"], index: false }));
app.get("/pret/fiche", (_req, res) => res.sendFile(path.join(pretPublic, "fiche-pret.html")));
app.get("/pret/admin", (_req, res) => res.sendFile(path.join(pretPublic, "admin-parc.html")));
app.use("/pret/api", loansRouter);

app.use((req, res, next) => {
  const url = req.originalUrl || req.url || "";
  const method = req.method;

  res.on("finish", async () => {
    try {
      const success = res.statusCode >= 200 && res.statusCode < 300;
      if (!success || method !== "POST") return;

      if (url.startsWith("/formulaire-piece")) {
        await stats.recordSubmission("piece");
      } else if (url.startsWith("/formulaire-piecepl")) {
        await stats.recordSubmission("piecepl");
      } else if (url.startsWith("/formulaire-pneu")) {
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
  try { await stats.initCounters(); } catch (e) { console.warn("[COMPTEUR] initCounters souci:", e?.message || e); }
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
})();

function esc(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fmtFR(dateStr = "") {
  const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : dateStr;
}

async function makeLeavePdf({ logoUrl, magasin, nomPrenom, service, nbJours, du, au }) {
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));


  try {
    const resp = await fetch(logoUrl);
    const buf = Buffer.from(await resp.arrayBuffer());
    doc.image(buf, 50, 40, { width: 110 });
  } catch (e) {
    console.warn("[CONGES][PDF] Logo non chargé:", e.message);
  }

  doc.fontSize(22).font("Helvetica-Bold").text("DEMANDE DE JOURS DE CONGÉS", 0, 130, { align: "center" });

  let y = 180;

  doc.fontSize(14).font("Helvetica-Bold").text("SITE :", 50, y);
  doc.font("Helvetica").text(magasin || "", 95, y);
  y += 50;

  const parts = String(nomPrenom || "").trim().split(/\s+/);
  const prenom = parts.slice(0, -1).join(" ");
  const nom = parts.slice(-1)[0] || "";

  doc.font("Helvetica").fontSize(14);
  doc.text("NOM :", 50, y);     doc.text(nom, 95, y, { underline: true, width: 180 });
  doc.text("PRENOM :", 330, y); doc.text(prenom, 395, y, { underline: true, width: 160 });
  y += 60;

  const services = ["Magasin V.L", "Magasin P.L", "Industrie",
                    "Atelier V.L", "Atelier P.L", "Rectification",
                    "Administratif", "Commercial", "Matériel"];
  const cols = 3, colW = (545 - 50) / cols, box = 12, lh = 30;
  services.forEach((s, i) => {
    const r = Math.floor(i / cols), c = i % cols;
    const x = 50 + c * colW, yy = y + r * lh;
    doc.rect(x, yy, box, box).stroke();
    if (service && s.toLowerCase() === String(service).toLowerCase()) {
      doc.font("Helvetica-Bold").text("X", x + 2, yy - 2);
    }
    doc.font("Helvetica").text(s, x + box + 8, yy - 2);
  });
  y += Math.ceil(services.length / cols) * lh + 40;

  doc.fontSize(14).text(`Demande de pouvoir bénéficier de ${nbJours} jour(s) de congés`, 50, y);
  y += 35;

  doc.text(`du ${du} au ${au} inclus.`, 50, y);
  y += 70;

  doc.text("DATE :", 50, y); doc.moveTo(95, y + 12).lineTo(220, y + 12).stroke();
  doc.text("Signature de l’employé,", 380, y);
  y += 110;

  doc.font("Helvetica-Bold").text("RESPONSABLE DU SERVICE :", 50, y);
  doc.text("RESPONSABLE DE SITE :", 330, y);
  y += 25; doc.font("Helvetica");
  doc.text("NOM :", 50, y);     doc.moveTo(85, y + 12).lineTo(220, y + 12).stroke();
  doc.text("NOM :", 330, y);    doc.moveTo(365, y + 12).lineTo(545, y + 12).stroke();
  y += 35;
  doc.text("SIGNATURE :", 50, y);  doc.moveTo(125, y + 12).lineTo(220, y + 12).stroke();
  doc.text("SIGNATURE :", 330, y); doc.moveTo(400, y + 12).lineTo(545, y + 12).stroke();

  doc.end();
  return done;
}