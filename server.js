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

console.log("[BOOT] public/conges ?", fs.existsSync(path.join(__dirname, "public", "conges")));
console.log("[BOOT] public/conges/index.html ?", fs.existsSync(path.join(__dirname, "public", "conges", "index.html")));

app.get("/conges/ping", (_req, res) => res.status(200).send("pong"));

app.get("/conges", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "conges", "index.html"));
});

app.post("/conges/api", async (req, res) => {
  try {
    const { magasin, nomPrenom, service, nbJours, dateDu, dateAu, email, signatureData } = req.body || {};
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
      signatureData,
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
      if (url.startsWith("/formulaire-piece"))      await stats.recordSubmission("piece");
      else if (url.startsWith("/formulaire-piecepl")) await stats.recordSubmission("piecepl");
      else if (url.startsWith("/formulaire-pneu"))    await stats.recordSubmission("pneu");
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

async function makeLeavePdf({ logoUrl, magasin, nomPrenom, service, nbJours, du, au, signatureData }) {
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const pageLeft = 50;
  const pageRight = 545;
  const logoX = pageLeft;
  const logoY = 40;
  const logoW = 120;

  let titleY = logoY + 45;
  const titleX = logoX + logoW + 20;
  const titleWidth = pageRight - titleX;

  try {
    const resp = await fetch(logoUrl);
    const buf = Buffer.from(await resp.arrayBuffer());
    doc.image(buf, logoX, logoY, { width: logoW });
  } catch (e) {
    console.warn("[CONGES][PDF] Logo non chargé:", e.message);
  }

  const titleStr = "DEMANDE DE JOURS DE CONGÉS";
  doc.fontSize(18).font("Helvetica-Bold").text(titleStr, titleX, titleY, {
    width: titleWidth,
    align: "left",
  });

  let y = 180;

  const bodySize = 13;
  const labelGap = 32;
  const rowGap = 38;
  const afterServicesGap = 38;
  const afterDemandGap = 26;
  const afterPeriodGap = 36;

  doc.fontSize(bodySize).font("Helvetica-Bold").text("SITE :", pageLeft, y);
  doc.font("Helvetica").text(magasin || "", pageLeft + 55, y);
  y += labelGap;

  const parts = String(nomPrenom || "").trim().split(/\s+/);
  const prenom = parts.slice(0, -1).join(" ");
  const nom = parts.slice(-1)[0] || "";
  doc.font("Helvetica").fontSize(bodySize);
  doc.text("NOM :", pageLeft, y);
  doc.text(nom, pageLeft + 55, y, { width: 170 });
  doc.text("PRENOM :", 330, y);
  doc.text(prenom, 400, y, { width: 150 });
  y += rowGap;

  const services = [
    "Magasin V.L", "Magasin P.L", "Industrie",
    "Atelier V.L", "Atelier P.L", "Rectification",
    "Administratif", "Commercial", "Matériel"
  ];
  const cols = 3, colW = (pageRight - pageLeft) / cols, box = 11, lh = 28;
  doc.fontSize(12);
  services.forEach((s, i) => {
    const r = Math.floor(i / cols), c = i % cols;
    const x = pageLeft + c * colW, yy = y + r * lh;
    doc.rect(x, yy, box, box).stroke();
    if (service && s.toLowerCase() === String(service).toLowerCase()) {
      doc.font("Helvetica-Bold").text("X", x + 2, yy - 2);
    }
    doc.font("Helvetica").text(s, x + box + 6, yy - 2);
  });
  y += Math.ceil(services.length / cols) * lh + afterServicesGap;

  doc.fontSize(bodySize).text(`Demande de pouvoir bénéficier de ${nbJours} jour(s) de congés`, pageLeft, y);
  y += afterDemandGap;

  doc.text(`du ${du}`, pageLeft, y);
  y += 20;
  doc.text(`au ${au} inclus.`, pageLeft, y);
  y += afterPeriodGap;

  doc.text("Signature de l’employé,", 370, y);
  if (signatureData && /^data:image\/png;base64,/.test(signatureData)) {
    try {
      const b64 = signatureData.split(",")[1];
      const sigBuf = Buffer.from(b64, "base64");
      const sigY = y + 14;
      doc.image(sigBuf, 370, sigY, { width: 150 });
      y = Math.max(y + 90, sigY + 90);
    } catch (e) {
      console.warn("[CONGES][PDF] Signature non intégrée:", e.message);
      y += 70;
    }
  } else {
    y += 70;
  }

  const colLeft = pageLeft;
  const colRight = 330;
  doc.font("Helvetica-Bold").text("RESPONSABLE DU SERVICE :", colLeft, y);
  doc.text("RESPONSABLE DE SITE :", colRight, y);
  y += 22; doc.font("Helvetica").fontSize(bodySize);
  doc.text("NOM :", colLeft, y);
  doc.text("NOM :", colRight, y);
  y += 22;
  doc.text("SIGNATURE :", colLeft, y);
  doc.text("SIGNATURE :", colRight, y);

  doc.end();
  return done;
}