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
import atelier from "./atelier/index.js";

import presences from "./routes/presences.js";

import ftp from "basic-ftp";
import os from "os";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();
app.set("trust proxy", 1);
app.use(cors());
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

app.use("/atelier", atelier);
app.use("/suivi-dossier", suiviDossier);
app.use('/presence', presences);
app.use("/presences", express.static(path.join(__dirname, "presences")));

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
    fetch(APPS_SCRIPT_URL + "?" + new URLSearchParams(req.query), {
      headers: { "User-Agent": "televente-proxy/1.0" }
    }).then(r => r.json());

  try {
    let data;
    try { data = await tryOnce(); }
    catch { await new Promise(t => setTimeout(t, 400)); data = await tryOnce(); }
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(data);
  } catch (e) {
    res.status(502).json({ error: "proxy_failed", message: e?.message || "Bad gateway" });
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

function esc(str = "") {
  return String(str)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function fmtFR(dateStr = "") {
  const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : dateStr;
}

const FTP_ROOT = (process.env.FTP_BACKUP_FOLDER || "/").replace(/\/$/, "");
const PRES_ROOT = `${FTP_ROOT}/presences`;
const LEAVES_FILE = `${PRES_ROOT}/leaves.json`;
const LEAVE_DIR   = `${FTP_ROOT}/presence/leave`;
const FTP_DEBUG = String(process.env.PRESENCES_FTP_DEBUG||"0")==="1";

function tlsOptions(){
  const rejectUnauthorized = String(process.env.FTP_TLS_REJECT_UNAUTH||"1")==="1";
  const servername = process.env.FTP_HOST || undefined;
  return { rejectUnauthorized, servername };
}
async function ftpClient(){
  const client = new ftp.Client(30_000);
  if (FTP_DEBUG) client.ftp.verbose = true;
  await client.access({
    host: process.env.FTP_HOST, user: process.env.FTP_USER, password: process.env.FTP_PASSWORD,
    port: process.env.FTP_PORT ? Number(process.env.FTP_PORT) : 21,
    secure: String(process.env.FTP_SECURE||"false")==="true", secureOptions: tlsOptions()
  });
  try { client.ftp.socket?.setKeepAlive?.(true, 10_000); } catch {}
  return client;
}
function tmpFile(name){ return path.join(os.tmpdir(), name); }
async function dlJSON(client, remote){
  const out = tmpFile("lv_"+Date.now()+".json");
  try{
    await client.downloadTo(out, remote);
    return JSON.parse(fs.readFileSync(out,"utf8"));
  }catch{ return null }
  finally{ try{ fs.unlinkSync(out); }catch{} }
}
async function upJSON(client, remote, obj){
  const out = tmpFile("lv_up_"+Date.now()+".json");
  fs.writeFileSync(out, JSON.stringify(obj));
  const dir = path.posix.dirname(remote);
  await client.ensureDir(dir);
  await client.uploadFrom(out, remote);
  try{ fs.unlinkSync(out) }catch{}
}
async function upText(client, remote, buf){
  const dir = path.posix.dirname(remote);
  await client.ensureDir(dir);
  const out = tmpFile("lv_file_"+Date.now());
  fs.writeFileSync(out, buf);
  await client.uploadFrom(out, remote);
  try{ fs.unlinkSync(out) }catch{}
}

async function appendLeave(payload){
  await (async ()=>{
    let client;
    try{
      client = await ftpClient();

      const arr = (await dlJSON(client, LEAVES_FILE)) || [];
      const item = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
        createdAt: new Date().toISOString(),
        status: "pending",
        ...payload
      };
      arr.push(item);
      await upJSON(client, LEAVES_FILE, arr);

      const safe = (s)=> String(s||"").normalize("NFKD").replace(/[^\w.-]+/g,"_").slice(0,64);
      const base = `${item.createdAt.slice(0,10)}_${safe(item.magasin)}_${safe(item.nom)}_${safe(item.prenom)}_${item.id}.json`;
      const remoteUnit = `${LEAVE_DIR}/${base}`;
      await upText(client, remoteUnit, JSON.stringify(item, null, 2));

      console.log("[LEAVES] appended:", { id:item.id, magasin:item.magasin, du:item.dateDu, au:item.dateAu, unit:remoteUnit });
    }catch(e){
      console.error("[LEAVES] append error:", e?.message||e);
    }finally{
      try{ client?.close() }catch{}
    }
  })();
}

app.get("/conges/ping", (_req, res) => res.status(200).send("pong"));
app.get("/conges", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "conges", "index.html"));
});

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

    const duFR = fmtFR(dateDu);
    const auFR = fmtFR(dateAu);
    const nomPrenomStr = `${_nom.toUpperCase()} ${_prenom}`;
    await appendLeave({
      magasin, nom:_nom, prenom:_prenom, service, nbJours:n, dateDu, dateAu, email
    });

    let emailSent = false;
    try {
      const { MAIL_CG, GMAIL_USER, GMAIL_PASS, FROM_EMAIL } = process.env;
      if (!MAIL_CG || !GMAIL_USER || !GMAIL_PASS) {
        console.warn("[CONGES] smtp_not_configured:", { MAIL_CG: !!MAIL_CG, GMAIL_USER: !!GMAIL_USER, GMAIL_PASS: !!GMAIL_PASS });
      } else {
        const cleanedPass = String(GMAIL_PASS).replace(/["\s]/g, "");
        const transporter = nodemailer.createTransport({ service: "gmail", auth: { user: GMAIL_USER, pass: cleanedPass } });

        const pdfBuffer = await makeLeavePdf({
          logoUrl: "https://raw.githubusercontent.com/docudurand/mes-formulaires/main/logodurand.png",
          magasin, nomPrenom: nomPrenomStr, service, nbJours: n, du: duFR, au: auFR, signatureData,
        });

        const toRecipients = resolveRecipient(magasin, service, MAIL_CG);
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
          attachments: [{ filename: `Demande-conges-${nomPrenomStr.replace(/[^\w.-]+/g, "_")}.pdf`, content: pdfBuffer, contentType: "application/pdf" }],
        });

        emailSent = true;
      }
    } catch (mailErr) {
      console.error("[CONGES][MAIL] Erreur:", mailErr?.message || mailErr);
    }

    res.json({ ok: true, emailSent });
  } catch (e) {
    console.error("[CONGES] Erreur inattendue:", e);
    res.status(500).json({ ok: false, error: "send_failed" });
  }
});

app.get("/healthz", (_req, res) => res.sendStatus(200));
app.get("/", (_req, res) => res.status(200).send("📝 Mes Formulaires – service opérationnel"));

app.use("/formtelevente", formtelevente);
app.use("/formulaire-piece", formulairePiece);
app.use("/formulaire-piecepl", formulairePiecePL);
app.use("/formulaire-pneu", formulairePneu);

const pretPublic = path.join(__dirname, "pretvehiculed", "public");
app.use("/pret", express.static(pretPublic, { extensions: ["html", "htm"], index: false }));
app.get("/pret/fiche", (_req, res) => res.sendFile(path.join(pretPublic, "fiche-pret.html")));
app.get("/pret/admin", (_req, res) => res.sendFile(path.join(pretPublic, "admin-parc.html")));
app.use("/pret/api", loansRouter);

app.use((_req, res) => res.status(404).json({ error: "Not Found" }));

const PORT = process.env.PORT || 3000;
(async () => {
  try { await stats.initCounters(); }
  catch (e) { console.warn("[COMPTEUR] initCounters souci:", e?.message || e); }
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
})();

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

  try {
    const resp = await fetch(logoUrl);
    const buf = Buffer.from(await resp.arrayBuffer());
    doc.image(buf, logoX, logoY, { width: logoW });
  } catch (e) { }

  doc.fontSize(18).font("Helvetica-Bold").text("DEMANDE DE JOURS DE CONGÉS", logoX + logoW + 20, logoY + 45);

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
      const pad = Math.max(2, Math.round(box * 0.2));
      doc.moveTo(x + pad, yy + pad).lineTo(x + box - pad, yy + box - pad).stroke();
      doc.moveTo(x + box - pad, yy + pad).lineTo(x + pad, yy + box - pad).stroke();
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
    } catch { y += 70; }
  } else { y += 70; }

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