import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import nodemailer from "nodemailer";
import * as ftp from "basic-ftp";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const router = express.Router();

const FRAME_ANCESTORS =
  "frame-ancestors 'self' https://documentsdurand.wixsite.com https://*.wixsite.com https://*.wix.com https://*.editorx.io;";
router.use((req, res, next) => {
  res.removeHeader("X-Frame-Options");
  res.setHeader("Content-Security-Policy", FRAME_ANCESTORS);
  next();
});

router.use(express.json({ limit: "2mb" }));
router.use(express.urlencoded({ extended: true, limit: "2mb" }));

const publicDir = path.join(__dirname, "public");
router.use(express.static(publicDir, {
  extensions: ["html", "htm"],
  index: false,
  setHeaders: (res, p) => {
    res.setHeader("Content-Security-Policy", FRAME_ANCESTORS);
    if (p.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
  }
}));
router.get("/", (_req, res) => {
  const f = path.join(publicDir, "index.html");
  if (fs.existsSync(f)) return res.sendFile(f);
  res.status(500).type("text").send("atelier/public/index.html introuvable.");
});

const dataDir = path.join(__dirname, ".data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const CASES_FILE      = path.join(dataDir, "cases.json");
const COUNTER_FILE    = path.join(dataDir, "counter.json");
const FTP_REMOTE_FILE = `${(process.env.FTP_BACKUP_FOLDER || "/")}/atelier_cases.json`;

function readJsonSafe(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch { return fallback; }
}
function writeJsonSafe(file, obj) {
  try { fs.writeFileSync(file, JSON.stringify(obj, null, 2), "utf8"); } catch {}
}

let CASES = readJsonSafe(CASES_FILE, []);

function esc(s){ return String(s ?? "").replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':"&quot;"}[c])); }

function siteLabelForService(service = ""){
  if (service === "Contrôle injection Essence") return "RENAGE";
  if (service === "Rectification Culasse" || service === "Contrôle injection Diesel") return "ST EGREVE";
  return "";
}

function nextDossierNumber(){
  const cn = readJsonSafe(COUNTER_FILE, null);
  let current = 0;
  if (cn && Number.isFinite(cn.value)) {
    current = cn.value;
  } else {
    current = CASES.reduce((m, x) => Math.max(m, Number(x.no) || 0), 0);
  }
  const next = current + 1;
  writeJsonSafe(COUNTER_FILE, { value: next });
  return String(next).padStart(5, "0");
}

function gmailTransport() {
  const user = process.env.GMAIL_USER;
  const pass = String(process.env.GMAIL_PASS || "").replace(/["\s]/g, "");
  if (!user || !pass) return null;
  return nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
}

const DEST_ATELIER = {
  "Rectification Culasse": process.env.DEST_EMAIL_ATELIER_CULASSE,
  "Contrôle injection Diesel": process.env.DEST_EMAIL_ATELIER_DIESEL,
  "Contrôle injection Essence": process.env.DEST_EMAIL_ATELIER_ESSENCE,
  "__DEFAULT__": process.env.MAIL_TO || process.env.MAIL_CG || process.env.GMAIL_USER || ""
};

function destForService(service = ""){
  return DEST_ATELIER[service] || DEST_ATELIER.__DEFAULT__;
}

async function sendServiceMail(no, snapshot){
  const t = gmailTransport();
  if (!t) return;

  const h = snapshot.header || {};
  const c = snapshot.culasse || null;
  const inj = snapshot.injecteur || null;

  const to = destForService(h.service || "");
  if (!to) return;

  const subject = `[Nouvelle demande] Dossier ${no} – ${h.service || "-"} – ${h.client || "-"}`;
  const rowsMain = [
    ["N° dossier", no],
    ["Service", h.service || "-"],
    ["Magasin", h.magasin || "-"],
    ["Date demande", h.dateDemande || "-"],
    ["Client", h.client || "-"],
    ["N° de compte", h.compte || "-"],
    ["Téléphone", h.telephone || "-"],
    ["Email client", h.email || "-"],
    ["Véhicule", h.vehicule || "-"],
    ["Immatriculation", h.immat || "-"],
  ];

  let extra = "";
  if (h.service === "Rectification Culasse" && c) {
    extra += `
      <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:600">Cylindre</td><td style="padding:8px;border:1px solid #e5e7eb">${esc(c.cylindre||"-")}</td></tr>
      <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:600">Soupapes</td><td style="padding:8px;border:1px solid #e5e7eb">${esc(c.soupapes||"-")}</td></tr>
      <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:600">Carburant</td><td style="padding:8px;border:1px solid #e5e7eb">${esc(c.carburant||"-")}</td></tr>
    `;
  }
  if ((h.service === "Contrôle injection Diesel" || h.service === "Contrôle injection Essence") && inj){
    extra += `
      <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:600">Type</td><td style="padding:8px;border:1px solid #e5e7eb">${esc(inj.type||"-")}</td></tr>
      <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:600">Nb injecteurs</td><td style="padding:8px;border:1px solid #e5e7eb">${esc(inj.nombre||"-")}</td></tr>
    `;
  }
  const commentaires = (snapshot.commentaires || "").trim();

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;color:#111">
    <h2 style="margin:0 0 10px">Nouvelle demande – Dossier ${esc(no)}</h2>
    <table style="border-collapse:collapse;border:1px solid #e5e7eb;width:100%">
      ${rowsMain.map(([k,v])=>`
        <tr>
          <td style="padding:8px;border:1px solid #e5e7eb;font-weight:600">${esc(k)}</td>
          <td style="padding:8px;border:1px solid #e5e7eb">${esc(v)}</td>
        </tr>`).join("")}
      ${extra}
    </table>
    ${commentaires ? `
      <div style="margin-top:12px">
        <div style="font-weight:700;margin-bottom:6px">Commentaires</div>
        <div style="border:1px solid #e5e7eb;padding:10px;white-space:pre-wrap">${esc(commentaires)}</div>
      </div>` : ""}
  </div>`.trim();

  await t.sendMail({
    to,
    from: process.env.GMAIL_USER,
    subject,
    html
  });
}

async function sendClientStatusMail(no, entry) {
  try {
    const t = gmailTransport();
    if (!t) return;

    const h = (entry && entry.snapshot && entry.snapshot.header) || {};
    const to = (h.email || "").trim();
    if (!to) return;

    const subject = `Votre dossier ${no} – ${h.service || "Atelier"} – ${h.client || ""}`;
    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#111">
        <p>Bonjour,</p>
        <p>Nous vous informons que les travaux sont terminés et que la pièce a été <b>renvoyée</b>.</p>
        <table style="border-collapse:collapse;border:1px solid #e5e7eb;width:100%;margin-top:10px">
          <tr><td style="padding:8px 10px;border:1px solid #e5e7eb;font-weight:600">N° de dossier</td><td style="padding:8px 10px;border:1px solid #e5e7eb">${esc(no)}</td></tr>
          <tr><td style="padding:8px 10px;border:1px solid #e5e7eb;font-weight:600">Service</td><td style="padding:8px 10px;border:1px solid #e5e7eb">${esc(h.service || "-")}</td></tr>
          <tr><td style="padding:8px 10px;border:1px solid #e5e7eb;font-weight:600">Client</td><td style="padding:8px 10px;border:1px solid #e5e7eb">${esc(h.client || "-")}</td></tr>
          <tr><td style="padding:8px 10px;border:1px solid #e5e7eb;font-weight:600">Magasin</td><td style="padding:8px 10px;border:1px solid #e5e7eb">${esc(h.magasin || "-")}</td></tr>
        </table>
        <p style="margin-top:14px">Cordialement,<br>Durand Services – Atelier</p>
      </div>
    `;
    await t.sendMail({ to, from: process.env.GMAIL_USER, subject, html });
  } catch (e) {
    console.warn("[ATELIER][MAIL Client] échec:", e?.message || e);
  }
}

async function withFtpClient(fn){
  const client = new ftp.Client(20 * 1000);

  const secure = String(process.env.FTP_SECURE || "false") === "true";
  const insecure = String(process.env.FTP_TLS_INSECURE || "0") === "1";

  try{
    await client.access({
      host: process.env.FTP_HOST,
      user: process.env.FTP_USER,
      password: process.env.FTP_PASSWORD,
      port: Number(process.env.FTP_PORT || 21),
      secure,
      secureOptions: insecure ? { rejectUnauthorized: false } : undefined
    });
    return await fn(client);
  } finally { client.close(); }
}

async function pushCasesToFtp(){
  try {
    const tmp = path.join(dataDir, "cases.tmp.json");
    fs.writeFileSync(tmp, JSON.stringify(CASES, null, 2), "utf8");
    await withFtpClient(async (c) => { await c.uploadFrom(tmp, FTP_REMOTE_FILE); });
    fs.unlinkSync(tmp);
  } catch (e) {
    console.warn("[ATELIER][FTP] push: échec:", e?.message || e);
  }
}

async function pullCasesFromFtp(){
  try {
    const tmp = path.join(dataDir, "cases.remote.json");
    await withFtpClient(async (c) => { await c.downloadTo(tmp, FTP_REMOTE_FILE); });
    const remote = readJsonSafe(tmp, null);
    if (Array.isArray(remote)) {
      CASES = remote;
      writeJsonSafe(CASES_FILE, CASES);
    }
    try { fs.unlinkSync(tmp); } catch {}
  } catch (e) {
    console.warn("[ATELIER][FTP] pull: échec:", e?.message || e);
  }
}

function renderPrintHTML(payload = {}, no = ""){
  const meta   = payload.meta   || {};
  const header = payload.header || {};
  const culasse = payload.culasse || null;
  const commentaires = (payload.commentaires || "").trim();
  const injecteur = payload.injecteur || null;

  const LOGO_URL = esc(meta.logoUrl || "https://raw.githubusercontent.com/docudurand/mes-formulaires/main/logodurand.png");
  const titre    = esc(header.service || meta.titre || "Demande d’intervention");
  const siteLbl  = siteLabelForService(header.service);

  const opsHTML = (() => {
    if (!culasse || !Array.isArray(culasse.operations) || !culasse.operations.length) {
      return `<div class="muted">Aucune opération cochée.</div>`;
    }
    return culasse.operations.map(op => {
      const refs = (op.references || []).map(r => {
        const bits = [];
        if (r.reference)   bits.push(esc(r.reference));
        if (r.libelleRef)  bits.push(esc(r.libelleRef));
        if (r.prixHT || r.prixHT === 0) bits.push(esc(String(r.prixHT)) + " € HT");
        return `<div class="subbullet">- ${bits.join(" – ")}</div>`;
      }).join("");
      return `<div class="bullet">• ${esc(op.libelle || op.ligne)}</div>${refs}`;
    }).join("");
  })();

  const piecesHTML = (() => {
    const list = (culasse && culasse.piecesAFournir) || [];
    if (!list.length) return `<div class="muted">Aucune pièce sélectionnée.</div>`;
    return list.map(p => `<div class="bullet">• ${esc(p)}</div>`).join("");
  })();

  const dossierTag = no ? `<div class="dossier-tag">Dossier n° ${esc(no)}</div>` : "";

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>${titre}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  @page{ size:A4; margin:0 }
  html,body{ margin:0; }
  body{ font-family:Arial,Helvetica,sans-serif; color:#111; margin:12mm; position:relative; }
  .header{ position: relative; display: grid; grid-template-columns:130px 1fr; align-items: center; column-gap:18px; padding-bottom: 6px; }
  .header + .section{ margin-top:28px; }
  .logo{ width:130px; height:auto; object-fit:contain }
  .title{ position:absolute; left:50%; transform:translateX(-50%); top:12mm; margin:0; font-size:22px; font-weight:800; color:#0b4a6f; letter-spacing:.2px; }
  .site-tag{ position:absolute; top:6mm; right:12mm; font-weight:800; color:#0b4a6f; font-size:14px; }
  .dossier-tag{ position:absolute; top:14mm; right:12mm; font-weight:800; color:#0b4a6f; font-size:14px; }
  .label{ font-weight:700 }
  .section{ margin-top:18px; }
  .section h3{ margin:20px 0 12px; color:#0b4a6f; font-size:16px; }
  .two{ display:grid; grid-template-columns:1fr 1fr; gap:12px 30px; }
  .bullet{ margin:6px 0; } .subbullet{ margin-left:22px; margin-top:3px; }
  .area{ border:1px solid #222; padding:10px; min-height:60px; white-space:pre-wrap; }
</style>
</head>
<body>
  ${siteLbl ? `<div class="site-tag">${esc(siteLbl)}</div>` : ''}
  ${dossierTag}
  <div class="header">
    <img class="logo" src="${LOGO_URL}" alt="Logo Durand">
    <h1 class="title">${titre}</h1>
  </div>

  <div class="section">
    <h3>Informations client</h3>
    <div class="two">
      <div><span class="label">Nom du client : </span>${esc(header.client)}</div>
      <div><span class="label">N° de compte : </span>${esc(header.compte)}</div>
      <div><span class="label">Téléphone : </span>${esc(header.telephone)}</div>
      <div><span class="label">Adresse mail : </span>${esc(header.email)}</div>
      <div><span class="label">Marque/Modèle : </span>${esc(header.vehicule)}</div>
      <div><span class="label">Immatriculation : </span>${esc(header.immat)}</div>
      <div><span class="label">Magasin d'envoi : </span>${esc(header.magasin)}</div>
      <div><span class="label">Date de la demande : </span>${esc(header.dateDemande)}</div>
    </div>
  </div>

  ${header.service === "Rectification Culasse" && culasse ? `
  <div class="section">
    <h3>Détails Rectification Culasse</h3>
    <div class="two">
      <div><span class="label">Cylindre : </span>${esc(culasse.cylindre)}</div>
      <div><span class="label">Soupapes : </span>${esc(culasse.soupapes)}</div>
      <div><span class="label">Carburant : </span>${esc(culasse.carburant)}</div>
    </div>
  </div>

  <div class="section">
    <h3>Opérations (cochées)</h3>
    ${opsHTML}
  </div>

  <div class="section">
    <h3>Pièces à Fournir</h3>
    ${piecesHTML}
  </div>
  ` : ""}

  ${(header.service === "Contrôle injection Diesel" || header.service === "Contrôle injection Essence") && injecteur ? `
  <div class="section">
    <h3>Détails Contrôle injection</h3>
    <div class="two">
      <div><span class="label">Type : </span>${esc(injecteur.type||'')}</div>
      <div><span class="label">Nombre d’injecteurs : </span>${esc(injecteur.nombre||'')}</div>
    </div>
  </div>
  ` : ""}

  ${commentaires ? `
  <div class="section">
    <h3>Commentaires</h3>
    <div class="area">${esc(commentaires)}</div>
  </div>
  ` : ""}

  <script>window.onload=()=>{ setTimeout(()=>window.print(), 120); };</script>
</body>
</html>`;
}

router.post("/api/print-html", (req, res) => {
  try {
    const raw  = (req.body && "payload" in req.body) ? req.body.payload : req.body;
    const data = (typeof raw === "string") ? JSON.parse(raw) : raw;
    const no = (data && data.no) ? String(data.no).padStart(5,"0") : "";
    const html = renderPrintHTML(data, no);
    res.setHeader("Content-Security-Policy", FRAME_ANCESTORS);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  } catch (e) {
    console.error("[ATELIER] print-html error:", e);
    return res.status(400).type("text").send("Bad payload");
  }
});

router.post("/api/submit", async (req, res) => {
  try {
    const raw  = (req.body && "payload" in req.body) ? req.body.payload : req.body;
    const data = (typeof raw === "string") ? JSON.parse(raw) : raw;

    const no = nextDossierNumber();
    const entry = {
      no,
      date: new Date().toISOString(),
      status: "Demande envoyé",
      snapshot: data
    };

    CASES.push(entry);
    writeJsonSafe(CASES_FILE, CASES);
    pushCasesToFtp().catch(()=>{});

    await sendServiceMail(no, data);

    res.json({ ok: true, no });
  } catch (e) {
    console.error("[ATELIER] submit error:", e);
    res.status(500).json({ ok:false, error:"submit_failed" });
  }
});

router.get("/api/cases", async (_req, res) => {
  try {
    await pullCasesFromFtp().catch(()=>{});
    res.json({ ok: true, data: CASES });
  } catch (e) {
    console.error("[ATELIER][CASES][GET] erreur:", e);
    res.status(500).json({ ok: false, error: "cases_read_failed" });
  }
});

router.post("/api/cases/:no/status", async (req, res) => {
  try {
    const { no } = req.params;
    const { status } = req.body || {};
    if (!no || !status) return res.status(400).json({ ok:false, error:"bad_request" });

    const idx = CASES.findIndex(x => String(x.no) === String(no));
    if (idx < 0) return res.status(404).json({ ok:false, error:"not_found" });

    CASES[idx].status = String(status);
    CASES[idx].dateStatus = new Date().toISOString();

    writeJsonSafe(CASES_FILE, CASES);
    pushCasesToFtp().catch(()=>{});

    const st = String(status).toLowerCase();
    if (st === "renvoyé" || st === "renvoye") {
      await sendClientStatusMail(no, CASES[idx]);
    }

    res.json({ ok:true });
  } catch (e) {
    console.error("[ATELIER][CASES][STATUS] erreur:", e);
    res.status(500).json({ ok:false, error:"update_failed" });
  }
});

router.get("/healthz", (_req, res) => res.type("text").send("ok"));

export default router;