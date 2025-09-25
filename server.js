import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import os from "os";
import axios from "axios";
import nodemailer from "nodemailer";
import crypto from "crypto";
import dayjs from "dayjs";
import PDFDocument from "pdfkit";
import { PDFDocument as PDFLib, StandardFonts, rgb } from "pdf-lib";
import ftp from "basic-ftp";

import * as stats from "./stats.js";
import formtelevente from "./formtelevente/index.js";
import formulairePiece from "./formulaire-piece/index.js";
import formulairePiecePL from "./formulaire-piecepl/index.js";
import formulairePneu from "./formulaire-pneu/index.js";
import suiviDossier from "./suivi-dossier/index.js";
import loansRouter from "./pretvehiculed/server-loans.js";
import atelier from "./atelier/index.js";
import presences from "./routes/presences.js";
import ramasseRouter from "./routes/ramasse.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();
app.set("trust proxy", 1);
app.use(cors());
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "https://mes-formulaires.onrender.com";

app.use("/atelier", atelier);
app.use("/suivi-dossier", suiviDossier);
app.use("/presence", presences);
app.use("/presences", express.static(path.join(__dirname, "presences")));
app.use("/public", express.static(path.join(process.cwd(), "public")));
app.use("/api/ramasse", ramasseRouter);
app.get("/ramasse", (req, res) => res.redirect("/public/ramasse.html"));

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
    try { r = await tryOnce(); }
    catch { await new Promise(t => setTimeout(t, 400)); r = await tryOnce(); }
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(r.data);
  } catch (e) {
    res.status(502).json({ error: "proxy_failed", message: e?.message || "Bad gateway" });
  }
});

app.get("/stats/counters", async (_req, res) => {
  try { const data = await stats.getCounters(); res.json({ ok: true, data }); }
  catch (e) { console.error("Erreur /stats/counters:", e); res.status(500).json({ ok: false, error: "Erreur de lecture des compteurs" }); }
});
app.get("/admin/compteurs", async (_req, res) => {
  try { const data = await stats.getCounters(); res.json(data); }
  catch (e) { console.error("Erreur /admin/compteurs:", e); res.status(500).json({ error: "Erreur de lecture des compteurs" }); }
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

console.log("[BOOT] public/conges ?", fs.existsSync(path.join(__dirname, "public", "conges")));
console.log("[BOOT] public/conges/index.html ?", fs.existsSync(path.join(__dirname, "public", "conges", "index.html")));
app.get("/conges/ping", (_req, res) => res.status(200).send("pong"));
app.get("/conges", (_req, res) => { res.sendFile(path.join(__dirname, "public", "conges", "index.html")); });

const RESPONSABLES = {
  "GLEIZE": {
    resp_service: { name: "FREDERICK SELVA", email: "dampichard2007@gmail.com" },
    resp_site:    { name: "DAMIEN PICHARD",  email: "magvl4gleize@durandservices.fr" },
  },
};

function recipientForMagasin(magasin, fallback) {
  const m = String(magasin || "").trim().toUpperCase();
  const conf = RESPONSABLES[m];
  if (conf) {
    const to = [conf.resp_service?.email, conf.resp_site?.email].filter(Boolean).join(",");
    if (to) return to;
  }
  return fallback;
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

const FTP_ROOT_BASE = (process.env.FTP_BACKUP_FOLDER || "/").replace(/\/$/, "");
const PRES_ROOT     = `${FTP_ROOT_BASE}/presences`;
const LEAVES_FILE   = `${PRES_ROOT}/leaves.json`;
const LEAVE_DIR     = `${FTP_ROOT_BASE}/presence/leave`;
const FTP_DEBUG     = String(process.env.PRESENCES_FTP_DEBUG||"0")==="1";

function tlsOptions(){
  const rejectUnauthorized = String(process.env.FTP_TLS_REJECT_UNAUTH||"1")==="1";
  const servername = process.env.FTP_HOST || undefined;
  return { rejectUnauthorized, servername };
}
async function ftpClient(){
  const client = new ftp.Client(30_000);
  if (FTP_DEBUG) client.ftp.verbose = true;
  await client.access({
    host: process.env.FTP_HOST,
    user: process.env.FTP_USER,
    password: process.env.FTP_PASSWORD,
    port: process.env.FTP_PORT ? Number(process.env.FTP_PORT) : 21,
    secure: String(process.env.FTP_SECURE||"false")==="true",
    secureOptions: tlsOptions()
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
  try {
    await client.uploadFrom(out, remote);
  } catch (e) {
    console.error("[FTP upJSON] fail", { dir, remote, code: e?.code, msg: e?.message });
    throw e;
  } finally {
    try{ fs.unlinkSync(out) }catch{}
  }
}
async function upText(client, remote, buf){
  const dir = path.posix.dirname(remote);
  await client.ensureDir(dir);
  const out = tmpFile("lv_file_"+Date.now());
  fs.writeFileSync(out, buf);
  await client.uploadFrom(out, remote);
  try{ fs.unlinkSync(out) }catch{}
}

async function appendLeave(payload) {
  let lastErr;
  for (let i=0; i<3; i++){
    let client;
    try{
      client = await ftpClient();
      await client.ensureDir(PRES_ROOT);
      await client.ensureDir(LEAVE_DIR);

      const arr = (await dlJSON(client, LEAVES_FILE)) || [];
      const item = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date().toISOString(),
        status: "pending",
        statusFr: "en attente",
        ...payload,
      };
      arr.push(item);
      await upJSON(client, LEAVES_FILE, arr);

      const safe = (s) => String(s || "").normalize("NFKD").replace(/[^\w.-]+/g, "_").slice(0, 64);
      const base = `${item.createdAt.slice(0, 10)}_${safe(item.magasin)}_${safe(item.nom)}_${safe(item.prenom)}_${item.id}.json`;
      const remoteUnit = `${LEAVE_DIR}/${base}`; // miroir unitaire
      await upText(client, remoteUnit, JSON.stringify(item, null, 2));

      try { client.close(); } catch {}
      return item.id;
    }catch(e){
      lastErr = e;
      try { client?.close(); } catch {}
      await new Promise(t=>setTimeout(t, 400*(i+1)));
    }
  }
  throw lastErr;
}

async function patchLeave(id, patch){
  let client;
  try{
    client = await ftpClient();
    const arr = (await dlJSON(client, LEAVES_FILE)) || [];
    const i = arr.findIndex(x => x.id === id);
    if (i >= 0) {
      arr[i] = { ...arr[i], ...patch };
      await upJSON(client, LEAVES_FILE, arr);
      const unit = `${LEAVE_DIR}/${arr[i].createdAt.slice(0,10)}_${arr[i].magasin}_${arr[i].nom}_${arr[i].prenom}_${arr[i].id}.json`
        .replace(/[^\w./-]+/g,"_");
      await upText(client, unit, JSON.stringify(arr[i], null, 2));
      return arr[i];
    }
    return null;
  } finally { try{ client?.close(); }catch{} }
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

const SIGN_COORDS = {
  resp_service: { page: 0, x: 60,  y: 180, w: 200, h: 60 },
  resp_site:    { page: 0, x: 330, y: 180, w: 200, h: 60 },
};
const NAME_COORDS = {
  resp_service: { page: 0, x: 120, y: 224, size: 12 },
  resp_site:    { page: 0, x: 390, y: 224, size: 12 },
};

function drawAuditFoot(page, font, txt){
  page.drawText(txt, { x: 40, y: 30, size: 8, font, color: rgb(0.25,0.25,0.25) });
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

    const leaveId = await appendLeave({
      magasin, nom:_nom, prenom:_prenom, service, nbJours:n, dateDu, dateAu, email
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

    const clientUp = await ftpClient();
    const remotePdfPath = `${LEAVE_DIR}/${leaveId}.pdf`;
    try{
      await clientUp.ensureDir(LEAVE_DIR);
      const tmp = tmpFile("leave_"+leaveId+".pdf");
      fs.writeFileSync(tmp, pdfBuffer);
      await clientUp.uploadFrom(tmp, remotePdfPath);
      try{ fs.unlinkSync(tmp); }catch{}
    } finally { try{ clientUp.close(); }catch{} }

    const tokenService = crypto.randomBytes(16).toString("hex");
    const tokenSite    = crypto.randomBytes(16).toString("hex");
    await patchLeave(leaveId, {
      pdfPath: remotePdfPath,
      tokens: { resp_service: tokenService, resp_site: tokenSite },
    });

    const { MAIL_CG, GMAIL_USER, GMAIL_PASS, FROM_EMAIL } = process.env;
    if (!GMAIL_USER || !GMAIL_PASS) {
      console.warn("[CONGES] smtp_not_configured:", { GMAIL_USER: !!GMAIL_USER, GMAIL_PASS: !!GMAIL_PASS });
      return res.status(500).json({ ok: false, error: "smtp_not_configured" });
    }
    const cleanedPass = String(GMAIL_PASS).replace(/["\s]/g, "");
    const transporter = nodemailer.createTransport({ service: "gmail", auth: { user: GMAIL_USER, pass: cleanedPass } });

    const linkService = `${PUBLIC_BASE_URL}/conges/sign/${leaveId}?role=resp_service&token=${tokenService}`;
    const linkSite    = `${PUBLIC_BASE_URL}/conges/sign/${leaveId}?role=resp_site&token=${tokenSite}`;

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
      <hr/>
      <p><b>Validation :</b></p>
      <p>
        <a href="${esc(linkService)}" style="display:inline-block;padding:10px 14px;border-radius:8px;background:#1d4ed8;color:#fff;text-decoration:none">
          Signer (Responsable de service)
        </a>
        &nbsp;&nbsp;
        <a href="${esc(linkSite)}" style="display:inline-block;padding:10px 14px;border-radius:8px;background:#0f766e;color:#fff;text-decoration:none">
          Signer (Responsable de site)
        </a>
      </p>
      <p style="color:#6b7280">Chaque lien est personnel et utilisable une seule fois.</p>
    `;

    const toRecipients = recipientForMagasin(magasin, process.env.MAIL_CG || email);

    await transporter.sendMail({
      to: toRecipients,
      from: `Demande jours de congés <${FROM_EMAIL || GMAIL_USER}>`,
      replyTo: email,
      subject,
      html,
      attachments: [
        {
          filename: `Demande-conges-${nomPrenomStr.replace(/[^\w.-]+/g, "_")}.pdf`,
          content: pdfBuffer,
          contentType: "application/pdf"
        }
      ],
    });

    console.log("[CONGES] email envoyé à", toRecipients, "reply-to", email);
    res.json({ ok: true, id: leaveId });
  } catch (e) {
    console.error("[CONGES] Erreur inattendue:", e);
    res.status(500).json({ ok: false, error: "send_failed" });
  }
});

app.get("/conges/sign/:id", async (req, res) => {
  const { id } = req.params;
  const role = String(req.query.role||"").trim();
  const token = String(req.query.token||"").trim();
  if (!["resp_service","resp_site"].includes(role) || !token) {
    return res.status(400).send("Lien invalide.");
  }
  res.setHeader("Content-Type","text/html; charset=utf-8");
  res.end(`
<!doctype html><meta charset="utf-8"/>
<title>Signature – Validation congés</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
body{font-family:system-ui,Segoe UI,Roboto,Arial;margin:24px;color:#111}
.wrap{max-width:560px;margin:0 auto}
canvas{border:1px solid #ddd;border-radius:8px;width:100%;height:220px;display:block;background:#fff}
button{padding:10px 14px;border-radius:10px;border:0;background:#1d4ed8;color:#fff;font-weight:700;cursor:pointer}
label{display:block;margin:12px 0 6px}
input{width:100%;padding:10px;border:1px solid #ddd;border-radius:8px}
.note{color:#666;margin-top:8px}
</style>
<div class="wrap">
  <h1>Signature – ${role === "resp_service" ? "Responsable de service" : "Responsable de site"}</h1>
  <p class="note">Signez pour valider la demande.</p>
  <canvas id="pad"></canvas>
  <label>Nom / Qualité</label>
  <input id="fullName" placeholder="Ex: Dupont – Resp. service"/>
  <div style="display:flex;gap:10px;margin-top:10px">
    <button id="clear" type="button" style="background:#6b7280">Effacer</button>
    <button id="ok" type="button">Valider ma signature</button>
  </div>
</div>
<script>
const role=${JSON.stringify(role)}, token=${JSON.stringify(token)}, id=${JSON.stringify(id)};
const c=document.getElementById('pad'), ctx=c.getContext('2d'); let draw=false, pts=[];
function size(){ const img=new Image(); img.onload=()=>{ c.width=c.clientWidth; c.height=220; ctx.fillStyle="#fff"; ctx.fillRect(0,0,c.width,c.height); ctx.drawImage(img,0,0,c.width,c.height); }
img.src=c.toDataURL(); }
window.addEventListener('resize', size); size();
function P(e){const r=c.getBoundingClientRect();const t=e.touches&&e.touches[0];return {x:(t?t.clientX:e.clientX)-r.left,y:(t?t.clientY:e.clientY)-r.top};}
c.addEventListener('mousedown', e=>{draw=true;pts=[P(e)]});
c.addEventListener('mousemove', e=>{ if(!draw)return; const a=pts[pts.length-1], b=P(e); ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke(); pts.push(b); });
["mouseup","mouseleave"].forEach(ev=>c.addEventListener(ev,()=>draw=false));
c.addEventListener('touchstart', e=>{e.preventDefault(); draw=true; pts=[P(e)]},{passive:false});
c.addEventListener('touchmove', e=>{e.preventDefault(); if(!draw)return; const a=pts[pts.length-1], b=P(e); ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke(); pts.push(b); },{passive:false});
c.addEventListener('touchend', ()=>draw=false);
document.getElementById('clear').onclick=()=>{ ctx.fillStyle="#fff"; ctx.fillRect(0,0,c.width,c.height); pts=[]; };
document.getElementById('ok').onclick=async()=>{
  if(pts.length<2) return alert("Merci de signer.");
  const fullName = document.getElementById('fullName').value.trim();
  if(!fullName) return alert("Merci d'indiquer votre nom/qualité.");
  const imageBase64 = c.toDataURL("image/png");
  const r = await fetch("/conges/sign/"+id, {
    method:"POST", headers: { "Content-Type":"application/json" },
    body: JSON.stringify({ role, token, imageBase64, fullName })
  });
  const j = await r.json().catch(()=>({}));
  if (j.ok) { alert("Signature enregistrée. Merci !"); location.href = "about:blank"; }
  else alert("Erreur: " + (j.error||""));
};
</script>`);
});

app.post("/conges/sign/:id", async (req, res) => {
  const { id } = req.params;
  const { role, token, imageBase64, fullName } = req.body || {};
  if (!["resp_service","resp_site"].includes(String(role))) {
    return res.status(400).json({ ok:false, error:"role_invalid" });
  }
  if (!imageBase64?.startsWith("data:image/png;base64,")) {
    return res.status(400).json({ ok:false, error:"image_missing" });
  }
  let client;
  try{
    client = await ftpClient();
    const arr = (await dlJSON(client, LEAVES_FILE)) || [];
    const i = arr.findIndex(x => x.id === id);
    if (i < 0) return res.status(404).json({ ok:false, error:"leave_not_found" });
    const item = arr[i];

    const tokens = item.tokens || {};
    const expected = tokens[role];
    if (!expected || expected !== token) {
      return res.status(401).json({ ok:false, error:"token_invalid_or_used" });
    }

    const remotePdf = item.pdfPath || `${LEAVE_DIR}/${id}.pdf`;
    const tmpPdf = tmpFile("pdf_"+id+".pdf");
    await client.downloadTo(tmpPdf, remotePdf);
    const pdfBytes = fs.readFileSync(tmpPdf);

    const pdfDoc = await PDFLib.load(pdfBytes, { updateMetadata:false });
    const pngBytes = Buffer.from(imageBase64.split(",")[1], "base64");
    const png = await pdfDoc.embedPng(pngBytes);

    const { page, x, y, w, h } = SIGN_COORDS[role];
    const pg = pdfDoc.getPage(page);
    const { width: iw, height: ih } = png.scale(1);
    const ratio = Math.min(w/iw, h/ih);
    const ww = iw*ratio, hh = ih*ratio;
    const xx = x + (w - ww)/2, yy = y + (h - hh)/2;
    pg.drawImage(png, { x: xx, y: yy, width: ww, height: hh });

    const namePos = NAME_COORDS[role];
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    pg.drawText(fullName, { x: namePos.x, y: namePos.y, size: namePos.size, font, color: rgb(0,0,0) });

    const auditTxt = `${dayjs().format("YYYY-MM-DD HH:mm")} • ${fullName} • ${role}`;
    pg.drawText(auditTxt, { x: 40, y: 30, size: 8, font, color: rgb(0.25,0.25,0.25) });

    const out = await pdfDoc.save();
    fs.writeFileSync(tmpPdf, out);
    await client.uploadFrom(tmpPdf, remotePdf);
    try{ fs.unlinkSync(tmpPdf); }catch{}

    const patch = { tokens: { ...tokens, [role]: null } };
    if (role === "resp_service") patch.signedService = { at: new Date().toISOString(), by: fullName };
    if (role === "resp_site")    patch.signedSite    = { at: new Date().toISOString(), by: fullName };

    const both =
      (patch.signedService || item.signedService) &&
      (patch.signedSite || item.signedSite);
    if (both) {
      patch.status   = "accepted";
      patch.statusFr = "validée";
    }

    arr[i] = { ...item, ...patch };
    await upJSON(client, LEAVES_FILE, arr);

    const unit = `${LEAVE_DIR}/${item.createdAt.slice(0,10)}_${item.magasin}_${item.nom}_${item.prenom}_${item.id}.json`
      .replace(/[^\w./-]+/g,"_");
    await upText(client, unit, JSON.stringify(arr[i], null, 2));

    if (both) {
      try {
        const { MAIL_CG, GMAIL_USER, GMAIL_PASS, FROM_EMAIL } = process.env;
        const cleanedPass = String(GMAIL_PASS||"").replace(/["\s]/g, "");
        if (GMAIL_USER && cleanedPass) {
          const transporter = nodemailer.createTransport({ service: "gmail", auth:{ user:GMAIL_USER, pass:cleanedPass } });
          const tmp2 = tmpFile("final_"+id+".pdf"); await client.downloadTo(tmp2, remotePdf);
          await transporter.sendMail({
            to: MAIL_CG || RESPONSABLES[String(item.magasin||"").toUpperCase()]?.resp_service?.email || "",
            cc: RESPONSABLES[String(item.magasin||"").toUpperCase()]?.resp_site?.email || undefined,
            from: `Validation congés <${FROM_EMAIL || GMAIL_USER}>`,
            subject: `Validation — ${String(item.nom||'').toUpperCase()} ${item.prenom||''}`,
            html: `<p>La demande a été <b>validée</b> par les deux responsables.</p>
                   <p>Employé : ${(item.nom||'').toUpperCase()} ${item.prenom||''}<br>
                      Période : ${item.dateDu} → ${item.dateAu} • ${item.nbJours||'?'} jour(s)</p>`,
            attachments: [{
              filename: `Demande-conges-${(item.nom||'').toUpperCase()}_${item.prenom||''}.pdf`,
              path: tmp2
            }]
          });
          try{ fs.unlinkSync(tmp2); }catch{}
        }
      } catch(e) {
        console.warn("[CONGES] post-accept mail a échoué:", e?.message||e);
      }
    }

    res.json({ ok:true, accepted: both===true });
  } catch(e){
    console.error(e);
    return res.status(500).json({ ok:false, error:String(e?.message||e) });
  } finally { try{ client?.close(); }catch{} }
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