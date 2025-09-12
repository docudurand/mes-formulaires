import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import nodemailer from "nodemailer";
import PDFDocument from "pdfkit";
import axios from "axios";

import * as stats from "./stats.js";

import formtelevente from "./formtelevente/index.js";
import formulairePiece from "./formulaire-piece/index.js";
import formulairePiecePL from "./formulaire-piecepl/index.js";
import formulairePneu from "./formulaire-pneu/index.js";
import suiviDossier from "./suivi-dossier/index.js";
import loansRouter from "./pretvehiculed/server-loans.js";
import atelier from "./atelier/index.js";

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.set("trust proxy", 1);

app.use(cors());
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));
app.use("/atelier", atelier);
app.use("/suivi-dossier", suiviDossier);

app.use((req, res, next) => {
  const url = req.originalUrl || req.url || "";
  const method = req.method;

  res.on("finish", async () => {
    try {
      const success = res.statusCode >= 200 && res.statusCode < 300;
      if (!success || method !== "POST") return;

      if (url.startsWith("/formulaire-piece"))        await stats.recordSubmission("piece");
      else if (url.startsWith("/formulaire-piecepl")) await stats.recordSubmission("piecepl");
      else if (url.startsWith("/formulaire-pneu"))    await stats.recordSubmission("pneu");
    } catch (e) {
      console.warn("[COMPTEUR] post-hook erreur:", e?.message || e);
    }
  });

  next();
});

const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbw5rfE4QgNBDYkYNmaI8NFmVzDvNw1n5KmVnlOKaanTO-Qikdh2x9gq7vWDOYDUneTY/exec";

app.get("/api/sheets/televente", async (req, res) => {
  const tryOnce = async () =>
    axios.get(APPS_SCRIPT_URL, {
      timeout: 12000,
      params: req.query,
      headers: { "User-Agent": "televente-proxy/1.0" },
    });

  try {
    let r;
    try {
      r = await tryOnce();
    } catch {
      await new Promise((t) => setTimeout(t, 400));
      r = await tryOnce();
    }
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(r.data);
  } catch (e) {
    res.status(502).json({ error: "proxy_failed", message: e?.message || "Bad gateway" });
  }
});

const CONGES_ADMIN_CODE = process.env.CONGES_ADMIN_CODE || "1234";

function normalizeUrl(v) {
  if (!v) return "";
  let s = String(v).trim();
  s = s.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  return s;
}

function getAppsScriptPresencesUrl() {
  const raw =
    process.env.APPS_SCRIPT_PRESENCES ||
    process.env.APPS_SCRIPT_PRESENCES_URL ||
    "";
  return normalizeUrl(raw);
}

app.get("/api/presences/_debug", (req, res) => {
  const url = getAppsScriptPresencesUrl();
  res.json({
    ok: true,
    has_APPS_SCRIPT_PRESENCES: Boolean(process.env.APPS_SCRIPT_PRESENCES),
    has_APPS_SCRIPT_PRESENCES_URL: Boolean(process.env.APPS_SCRIPT_PRESENCES_URL),
    url_preview: url ? url.slice(0, 60) + (url.length > 60 ? "…" : "") : "",
    ends_with_exec: !!url && url.endsWith("/exec"),
    node_env: process.env.NODE_ENV || null,
  });
});

app.get("/api/presences", async (req, res) => {
  try {
    const action = String(req.query.action || "");

    if (action === "leaves") {
      const code = req.get("X-Admin-Code") || req.query.adminCode;
      if (String(code) !== String(CONGES_ADMIN_CODE)) {
        return res.status(401).json({ error: "unauthorized" });
      }
    }

    const APPS_SCRIPT_PRESENCES = getAppsScriptPresencesUrl();
    if (!APPS_SCRIPT_PRESENCES) {
      return res.status(500).json({ error: "apps_script_presences_url_missing" });
    }

    const r = await axios.get(APPS_SCRIPT_PRESENCES, {
      params: req.query,
      timeout: 20000,
      headers: {
        "X-Admin-Code": req.get("X-Admin-Code") || "",
      },
    });
    res.status(200).json(r.data);
  } catch (e) {
    console.error("[PRESENCES][GET] proxy_failed:", e?.message || e);
    res.status(502).json({ error: "proxy_failed", message: e?.message || "Bad gateway" });
  }
});

app.post("/api/presences", async (req, res) => {
  try {
    const action = String(req.body?.action || "");

    if (action === "leave_decide") {
      const code = req.get("X-Admin-Code") || req.query.adminCode;
      if (String(code) !== String(CONGES_ADMIN_CODE)) {
        return res.status(401).json({ error: "unauthorized" });
      }
    }

    const APPS_SCRIPT_PRESENCES = getAppsScriptPresencesUrl();
    if (!APPS_SCRIPT_PRESENCES) {
      return res.status(500).json({ error: "apps_script_presences_url_missing" });
    }

    const r = await axios.post(APPS_SCRIPT_PRESENCES, req.body, {
      timeout: 30000,
      headers: {
        "X-Admin-Code": req.get("X-Admin-Code") || "",
      },
    });
    res.status(200).json(r.data);
  } catch (e) {
    console.error("[PRESENCES][POST] proxy_failed:", e?.message || e);
    res.status(502).json({ error: "proxy_failed", message: e?.message || "Bad gateway" });
  }
});

(() => {
  const url = getAppsScriptPresencesUrl();
  console.log(
    "[BOOT][PRESENCES] vars:",
    { APPS_SCRIPT_PRESENCES: !!process.env.APPS_SCRIPT_PRESENCES, APPS_SCRIPT_PRESENCES_URL: !!process.env.APPS_SCRIPT_PRESENCES_URL }
  );
  console.log("[BOOT][PRESENCES] using URL:", url ? url.slice(0, 80) + (url.length > 80 ? "…" : "") : "(none)");
  console.log("[BOOT][PRESENCES] ends_with_/exec ?", !!url && url.endsWith("/exec"));
})();

app.get("/stats/counters", async (_req, res) => {
  try {
    const data = await stats.getCounters();
    res.json({ ok: true, data });
  } catch (e) {
    console.error("Erreur /stats/counters:", e);
    res.status(500).json({ ok: false, error: "Erreur de lecture des compteurs" });
  }
});

app.get("/admin/compteurs", async (_req, res) => {
  try {
    const data = await stats.getCounters();
    res.json(data);
  } catch (e) {
    console.error("Erreur /admin/compteurs:", e);
    res.status(500).json({ error: "Erreur de lecture des compteurs" });
  }
});

app.get("/compteur", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "compteur.html"));
});

app.use(
  express.static(path.join(__dirname, "public"), {
    extensions: ["html", "htm"],
    index: false,
  })
);

console.log("[BOOT] public/presences ?",
  fs.existsSync(path.join(__dirname, "public", "presences"))
);
console.log("[BOOT] public/presences/index.html ?",
  fs.existsSync(path.join(__dirname, "public", "presences", "index.html"))
);

app.get("/presences/ping", (_req, res) => res.status(200).send("pong"));
app.get("/presences", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "presences", "index.html"));
});

console.log("[BOOT] public/conges ?",
  fs.existsSync(path.join(__dirname, "public", "conges"))
);
console.log("[BOOT] public/conges/index.html ?",
  fs.existsSync(path.join(__dirname, "public", "conges", "index.html"))
);

app.get("/conges/ping", (_req, res) => res.status(200).send("pong"));
app.get("/conges", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "conges", "index.html"));
});

const ROUTING = {
  "GLEIZE": {
    "Magasin V.L": "magvl4gleize@durandservices.fr",
    "Commercial":  "magvl4gleize@durandservices.fr",
  },
};
function resolveRecipient(magasin, service, globalDefault) {
  const m = String(magasin || "").trim().toUpperCase();
  const s = String(service || "").trim();
  const perMag = ROUTING[m];
  if (perMag && perMag[s]) return perMag[s];
  if (perMag && perMag["__DEFAULT"]) return perMag["__DEFAULT"];
  return globalDefault;
}

app.post("/conges/api", async (req, res) => {
  try {
    const { magasin, nomPrenom, nom, prenom, service, nbJours, dateDu, dateAu, email, signatureData } = req.body || {};
    const errors = [];

    if (!magasin) errors.push("magasin");
    if (!service) errors.push("service");
    if (!email) errors.push("email");

    const n = Number(nbJours);
    if (!Number.isFinite(n) || n <= 0) errors.push("nbJours");

    const d1 = new Date(dateDu), d2 = new Date(dateAu);
    if (!dateDu || !dateAu || isNaN(d1) || isNaN(d2) || d2 < d1) errors.push("plageDates");

    const reMail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!reMail.test(String(email))) errors.push("email");

    if (!signatureData || String(signatureData).length < 2000 || !/^data:image\/png;base64,/.test(signatureData)) {
      errors.push("signature");
    }

    let _nom = String(nom || "").trim();
    let _prenom = String(prenom || "").trim();
    if (!_nom && !_prenom && nomPrenom) {
      const parts = String(nomPrenom).trim().split(/\s+/);
      _nom = parts.slice(-1)[0] || "";
      _prenom = parts.slice(0, -1).join(" ");
    }
    if (!_nom) errors.push("nom");
    if (!_prenom) errors.push("prenom");

    if (errors.length) {
      return res.status(400).json({ ok:false, error:"invalid_fields", fields:errors });
    }

    const { MAIL_CG, GMAIL_USER, GMAIL_PASS, FROM_EMAIL } = process.env;
    if (!MAIL_CG || !GMAIL_USER || !GMAIL_PASS) {
      console.warn("[CONGES] smtp_not_configured:", { MAIL_CG: !!MAIL_CG, GMAIL_USER: !!GMAIL_USER, GMAIL_PASS: !!GMAIL_PASS });
      return res.status(500).json({ ok: false, error: "smtp_not_configured" });
    }

    const toRecipients = resolveRecipient(magasin, service, MAIL_CG);
    const cleanedPass = String(GMAIL_PASS).replace(/["\s]/g, "");
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: GMAIL_USER, pass: cleanedPass },
    });

    const duFR = fmtFR(dateDu);
    const auFR = fmtFR(dateAu);
    const nomPrenomStr = `${_nom.toUpperCase()} ${_prenom}`;

    const pdfBuffer = await makeLeavePdf({
      logoUrl: "https://raw.githubusercontent.com/docudurand/mes-formulaires/main/logodurand.png",
      magasin,
      nomPrenom: nomPrenomStr,
      service,
      nbJours: n,
      du: duFR,
      au: auFR,
      signatureData,
    });

    const subject = `Demande - ${nomPrenomStr}`;
    const html = `
      <h2>Demande de Jours de Congés</h2>
      <p><b>Magasin :</b> ${esc(magasin)}</p>
      <p><b>Nom :</b> ${esc(_nom)}</p>
      <p><b>Prénom :</b> ${esc(_prenom)}</p>
      <p><b>Service :</b> ${esc(service)}</p>
      <p><b>Demande :</b> ${n} jour(s) de congés</p>
      <p><b>Période :</b> du ${esc(duFR)} au ${esc(auFR)}</p>
      <p><b>Email du demandeur :</b> ${esc(email)}</p>
    `;

    await transporter.sendMail({
      to: toRecipients || MAIL_CG,
      from: `Demande jours de congés <${FROM_EMAIL || GMAIL_USER || "no-reply@localhost"}>`,
      replyTo: email,
      subject,
      html,
      attachments: [
        {
          filename: `Demande-conges-${nomPrenomStr.replace(/[^\w.-]+/g, "_")}.pdf`,
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    });

    const APPS_SCRIPT_PRESENCES = getAppsScriptPresencesUrl();
    if (APPS_SCRIPT_PRESENCES) {
      try {
        await axios.post(APPS_SCRIPT_PRESENCES, {
          action: "leave_request",
          magasin, nom: _nom, prenom: _prenom, service,
          nbJours: n, dateDu, dateAu, email, signatureData,
        }, { timeout: 20000 });
      } catch (e) {
        console.warn("[CONGES] leave_request -> Apps Script échec:", e?.message || e);
      }
    }

    console.log("[CONGES] email envoyé à", toRecipients || MAIL_CG, "reply-to", email);
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
// (suiviDossier déjà monté plus haut)

const pretPublic = path.join(__dirname, "pretvehiculed", "public");
app.use("/pret", express.static(pretPublic, { extensions: ["html", "htm"], index: false }));
app.get("/pret/fiche", (_req, res) => res.sendFile(path.join(pretPublic, "fiche-pret.html")));
app.get("/pret/admin", (_req, res) => res.sendFile(path.join(pretPublic, "admin-parc.html")));
app.use("/pret/api", loansRouter);

app.use((_req, res) => res.status(404).json({ error: "Not Found" }));


const PORT = process.env.PORT || 3000;
(async () => {
  try {
    await stats.initCounters();
  } catch (e) {
    console.warn("[COMPTEUR] initCounters souci:", e?.message || e);
  }
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

  function drawCrossInBox(doc, x, y, size) {
    const pad = Math.max(2, Math.round(size * 0.2));
    doc.save();
    doc.lineWidth(1.5);
    doc.moveTo(x + pad, y + pad).lineTo(x + size - pad, y + size - pad).stroke();
    doc.moveTo(x + size - pad, y + pad).lineTo(x + pad, y + size - pad).stroke();
    doc.restore();
  }

  const pageLeft = 50;
  const pageRight = 545;
  const logoX = pageLeft;
  const logoY = 40;
  const logoW = 120;

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
  doc.fontSize(18).font("Helvetica-Bold").text(titleStr, titleX, logoY + 45, { width: titleWidth, align: "left" });

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
  const _nom = parts[0] || "";
  const _prenom = parts.slice(1).join(" ");

  doc.font("Helvetica").fontSize(bodySize);
  doc.text("NOM :", pageLeft, y);
  doc.text(_nom, pageLeft + 55, y, { width: 250 });
  y += rowGap;

  doc.text("PRENOM :", pageLeft, y);
  doc.text(_prenom, pageLeft + 85, y, { width: 300 });
  y += rowGap;

  const services = [
    "Magasin V.L", "Magasin P.L", "Industrie",
    "Atelier V.L", "Atelier P.L", "Rectification",
    "Administratif", "Commercial", "Matériel"
  ];
  const cols = 3, colW = (pageRight - pageLeft) / cols, box = 11, lh = 28;

  doc.fontSize(12);
  services.forEach((s, i) => {
    const r  = Math.floor(i / cols), c = i % cols;
    const x  = pageLeft + c * colW;
    const yy = y + r * lh;

    doc.rect(x, yy, box, box).stroke();
    if (service && s.toLowerCase() === String(service).toLowerCase()) {
      drawCrossInBox(doc, x, yy, box);
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
