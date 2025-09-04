// atelier/index.js
import express from "express";
import axios from "axios";
import PDFDocument from "pdfkit";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import nodemailer from "nodemailer";
import * as ftp from "basic-ftp";
import { Writable } from "stream";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

/* ───────────────────────── CSP / Static ───────────────────────── */
const FRAME_ANCESTORS =
  "frame-ancestors 'self' https://documentsdurand.wixsite.com https://*.wixsite.com https://*.wix.com https://*.editorx.io;";

router.use((_req, res, next) => {
  res.removeHeader("X-Frame-Options");
  res.setHeader("Content-Security-Policy", FRAME_ANCESTORS);
  next();
});

const publicDir = path.join(__dirname, "public");
router.use(
  express.static(publicDir, {
    maxAge: "1h",
    setHeaders: (res, p) => {
      res.setHeader("Content-Security-Policy", FRAME_ANCESTORS);
      if (p.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
    }
  })
);
router.get("/", (_req, res) => {
  const f = path.join(publicDir, "index.html");
  if (fs.existsSync(f)) return res.sendFile(f);
  res.status(500).type("text").send("atelier/public/index.html introuvable.");
});

/* ───────────────────────── Fichiers locaux ───────────────────────── */
const DATA_DIR = path.join(__dirname, "data");
const CASES_FILE = path.join(DATA_DIR, "atelier_cases.json");
const COUNTER_FILE = path.join(DATA_DIR, "atelier_counter.txt");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function readJsonSafe(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}
function writeJsonSafe(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf8");
}
function readTextSafe(p, fallback = "0") {
  try { return fs.readFileSync(p, "utf8"); } catch { return fallback; }
}
function writeTextSafe(p, s) {
  fs.writeFileSync(p, String(s), "utf8");
}

/* ───────────────────────── State en mémoire ───────────────────────── */
let CASES = readJsonSafe(CASES_FILE, []);

/* ───────────────────────── Config FTP (FTPS robuste) ───────────────────────── */
function dequote(s) {
  return String(s ?? "").trim().replace(/^['"]|['"]$/g, "");
}

const FTP_HOST = dequote(process.env.FTP_HOST);
const FTP_PORT = Number(process.env.FTP_PORT || 21);
const FTP_USER = dequote(process.env.FTP_USER);
const FTP_PASS = dequote(process.env.FTP_PASS || process.env.FTP_PASSWORD || "");
const RAW_BACKUP_FOLDER = dequote(process.env.FTP_BACKUP_FOLDER || "/Disque 1/service");
const FTP_BACKUP_FOLDER = RAW_BACKUP_FOLDER.replace(/\/+$/, "");

const CASES_REMOTE = `${FTP_BACKUP_FOLDER}/atelier_cases.json`;
const COUNTER_REMOTE = `${FTP_BACKUP_FOLDER}/atelier_counter.txt`;

// explicit (défaut) | implicit | false
const SECURE_MODE = String(process.env.FTP_SECURE || "explicit").toLowerCase();
const secure =
  SECURE_MODE === "implicit" ? "implicit" :
  (SECURE_MODE === "false" || SECURE_MODE === "0") ? false : true;

const secureOptions = {
  // mettre FTP_TLS_REJECT_UNAUTH=0 sur Render si cert auto-signé
  rejectUnauthorized: String(process.env.FTP_TLS_REJECT_UNAUTH || "1") !== "0",
};

async function withFtp(fn) {
  const client = new ftp.Client();
  client.ftp.verbose = false;
  try {
    await client.access({
      host: FTP_HOST,
      port: Number(FTP_PORT || (secure === "implicit" ? 990 : 21)),
      user: FTP_USER,
      password: FTP_PASS,
      secure,
      secureOptions
    });
    return await fn(client);
  } finally {
    try { client.close(); } catch {}
  }
}

async function downloadToBuffer(client, remotePath) {
  const chunks = [];
  const sink = new Writable({
    write(chunk, _enc, cb) { chunks.push(Buffer.from(chunk)); cb(); }
  });
  await client.downloadTo(sink, remotePath);
  return Buffer.concat(chunks);
}
async function uploadBuffer(client, buffer, remotePath) {
  await client.uploadFrom(Buffer.from(buffer), remotePath);
}

/* ───────────────────────── Sync JSON dossiers / compteur ───────────────────────── */
async function pullCasesFromFtp() {
  return withFtp(async (client) => {
    try {
      const buf = await downloadToBuffer(client, CASES_REMOTE);
      const json = JSON.parse(buf.toString("utf8"));
      CASES = Array.isArray(json) ? json : [];
      writeJsonSafe(CASES_FILE, CASES);
    } catch (e) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[ATELIER][FTP] cases: DL échoué:", e?.message || e);
      }
    }
  });
}
async function pushCasesToFtp() {
  const buf = Buffer.from(JSON.stringify(CASES, null, 2), "utf8");
  return withFtp(async (client) => {
    try {
      await client.ensureDir(FTP_BACKUP_FOLDER);
      await uploadBuffer(client, buf, CASES_REMOTE);
    } catch (e) {
      console.warn("[ATELIER][FTP] cases: UL échoué:", e?.message || e);
    }
  });
}

function readCounterLocal() {
  return parseInt(readTextSafe(COUNTER_FILE, "0").trim(), 10) || 0;
}
function writeCounterLocal(n) {
  writeTextSafe(COUNTER_FILE, String(n));
}
async function pullCounterFromFtp() {
  return withFtp(async (client) => {
    try {
      const buf = await downloadToBuffer(client, COUNTER_REMOTE);
      const n = parseInt(buf.toString("utf8").trim(), 10);
      if (Number.isFinite(n)) writeCounterLocal(n);
    } catch (e) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[ATELIER][FTP] compteur: DL échoué:", e?.message || e);
      }
    }
  });
}
async function pushCounterToFtp(n) {
  const buf = Buffer.from(String(n), "utf8");
  return withFtp(async (client) => {
    try {
      await client.ensureDir(FTP_BACKUP_FOLDER);
      await uploadBuffer(client, buf, COUNTER_REMOTE);
    } catch (e) {
      console.warn("[ATELIER][FTP] compteur: UL échoué:", e?.message || e);
    }
  });
}

function pad5(n) { return String(n).padStart(5, "0"); }
async function nextCaseNo() {
  let cur = readCounterLocal();
  const nxt = (cur + 1) % 100000;
  writeCounterLocal(nxt);
  await pushCounterToFtp(nxt);
  return pad5(nxt);
}

/* ───────────────────────── Utils / PDF / rendu impression ───────────────────────── */
function esc(s) { return String(s ?? "").replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }

function siteLabelForService(service = "") {
  if (service === "Contrôle injection Essence") return "ST EGREVE";
  if (service === "Rectification Culasse" || service === "Contrôle injection Diesel") return "ST EGREVE";
  return "";
}

async function drawPdfToBuffer(data) {
  const meta = data.meta || {}, header = data.header || {}, culasse = data.culasse;
  const commentaires = (data.commentaires || "").trim();
  const injecteur = data.injecteur || null;

  return await new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margins: { top: 50, left: 52, right: 52, bottom: 54 } });
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));

      const BLUE = "#0b4a6f", TEXT = "#000000";
      function section(t){ doc.moveDown(1.8); doc.font("Helvetica-Bold").fontSize(15).fillColor(BLUE).text(t); doc.moveDown(0.8); doc.fillColor(TEXT).font("Helvetica").fontSize(12); }
      function kv(k,v){ doc.font("Helvetica-Bold").text(`${k} : `, { continued: true, lineGap: 7 }); doc.font("Helvetica").text(v || "-", { lineGap: 7 }); }
      function bullet(t){ doc.font("Helvetica-Bold").text(`• ${t}`, { lineGap: 6 }); }
      function subBullet(t){ doc.font("Helvetica").text(`- ${t}`, { indent: 22, lineGap: 6 }); }

      const logoX = 52, logoTop = 40, logoW = 110; let logoBottom = logoTop;
      if (meta.logoUrl) {
        try { const img = await axios.get(meta.logoUrl, { responseType: "arraybuffer" }); doc.image(Buffer.from(img.data), logoX, logoTop, { width: logoW }); logoBottom = logoTop + logoW; } catch {}
      }

      const titre = header.service || meta.titre || "Demande d’intervention";
      const usableW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const titleTop = 77;

      const siteLbl = siteLabelForService(header.service);
      if (siteLbl){ doc.font("Helvetica-Bold").fontSize(12).fillColor(BLUE); doc.text(siteLbl, doc.page.margins.left, 30, { width: usableW, align: "right" }); }

      doc.font("Helvetica-Bold").fontSize(22).fillColor(BLUE);
      const titleTextWidth = doc.widthOfString(titre);
      const pageCenterX = doc.page.width / 2;
      let titleX = pageCenterX - titleTextWidth / 2;
      const avoidLogoX = logoX + logoW + 18;
      if (titleX < avoidLogoX) titleX = avoidLogoX;
      doc.text(titre, titleX, titleTop, { width: titleTextWidth, align: "left", lineGap: 4 });
      const titleBottom = titleTop + doc.heightOfString(titre, { width: titleTextWidth });

      doc.fillColor(TEXT).font("Helvetica").fontSize(12);
      doc.y = Math.max(logoBottom, titleBottom) + 72;

      section("Informations client");
      kv("Nom du client", header.client);
      kv("N° de compte client", header.compte);
      kv("Téléphone client", header.telephone);
      kv("Adresse mail magasinier/receptionnaire", header.email);
      kv("Marque/Modèle", header.vehicule);
      kv("Immatriculation", header.immat);
      kv("Magasin", header.magasin);
      kv("Date de la demande", header.dateDemande);

      if (header.service === "Rectification Culasse" && culasse) {
        section("Détails Rectification Culasse");
        kv("Cylindre", culasse.cylindre);
        kv("Soupapes", culasse.soupapes);
        kv("Carburant", culasse.carburant);

        section("Opérations (cochées)");
        if (Array.isArray(culasse.operations) && culasse.operations.length) {
          culasse.operations.forEach(op=>{
            bullet(op.libelle || op.ligne);
            if (Array.isArray(op.references) && op.references.length) {
              op.references.forEach(ref=>{
                const parts=[]; if(ref.reference) parts.push(ref.reference);
                if(ref.libelleRef) parts.push(ref.libelleRef);
                if(ref.prixHT || ref.prixHT===0) parts.push(`${ref.prixHT} € HT`);
                subBullet(parts.join(" – "));
              });
            } else { subBullet("Aucune référence correspondante"); }
            doc.moveDown(0.2);
          });
        } else { doc.text("Aucune opération cochée."); }

        section("Pièces à Fournir");
        if (Array.isArray(culasse.piecesAFournir) && culasse.piecesAFournir.length) culasse.piecesAFournir.forEach(p => doc.text(`• ${p}`));
        else doc.text("Aucune pièce sélectionnée.");
      }

      if (header.service === "Contrôle injection Diesel" || header.service === "Contrôle injection Essence"){
        section("Détails Contrôle injection");
        kv("Type", (injecteur && injecteur.type) || "");
        kv("Nombre d’injecteurs", (injecteur && injecteur.nombre) || "");
      }

      if (commentaires) { section("Commentaires"); doc.text(commentaires); }

      doc.end();
    } catch (e) { reject(e); }
  });
}

function renderPrintHTML(payload = {}) {
  const meta = payload.meta || {};
  const header = payload.header || {};
  const culasse = payload.culasse || null;
  const commentaires = (payload.commentaires || "").trim();
  const injecteur = payload.injecteur || null;

  const LOGO_URL = esc(meta.logoUrl || "https://raw.githubusercontent.com/docudurand/mes-formulaires/main/logodurand.png");
  const titre = esc(header.service || meta.titre || "Demande d’intervention");
  const siteLbl = siteLabelForService(header.service);

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
  .header{
    position: relative;
    display: grid;
    grid-template-columns:130px 1fr;
    align-items: center;
    column-gap:18px;
    padding-bottom: 6px;
  }
  .header + .section{ margin-top:28px; }
  .logo{ width:130px; height:auto; object-fit:contain }
  .title{
    position:absolute; left:50%; transform:translateX(-50%);
    top:12mm; margin:0; font-size:22px; font-weight:800; color:#0b4a6f; letter-spacing:.2px;
  }
  .site-tag{ position:absolute; top:6mm; right:12mm; font-weight:800; color:#0b4a6f; font-size:14px; }
  .label{ font-weight:700 }
  .section{ margin-top:18px; }
  .section h3{ margin:20px 0 12px; color:#0b4a6f; font-size:16px; }
  .two{ display:grid; grid-template-columns:1fr 1fr; gap:12px 30px; }
  .bullet{ margin:6px 0; }
  .subbullet{ margin-left:22px; margin-top:3px; }
  .area{ border:1px solid #222; padding:10px; min-height:60px; white-space:pre-wrap; }
</style>
</head>
<body>
  ${siteLbl ? `<div class="site-tag">${esc(siteLbl)}</div>` : ""}
  <div class="header">
    <img class="logo" src="${LOGO_URL}" alt="Logo Durand">
    <h1 class="title">${titre}</h1>
  </div>

  <div class="section">
    <h3>Informations client</h3>
    <div class="two">
      <div><span class="label">Nom du client : </span>${esc(header.client)}</div>
      <div><span class="label">N° de compte client : </span>${esc(header.compte)}</div>
      <div><span class="label">Téléphone client : </span>${esc(header.telephone)}</div>
      <div><span class="label">Adresse mail magasinier/receptionnaire : </span>${esc(header.email)}</div>
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
  <div class="section"><h3>Opérations (cochées)</h3>${opsHTML}</div>
  <div class="section"><h3>Pièces à Fournir</h3>${piecesHTML}</div>
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

/* ───────────────────────── Email routage interne ───────────────────────── */
function resolveRecipients(service) {
  if (service === "Rectification Culasse") return process.env.MAIL_RC || "magvl4gleize@durandservices.fr";
  if (service === "Contrôle injection Diesel") return process.env.MAIL_INJ_D || "magvl4gleize@durandservices.fr";
  if (service === "Contrôle injection Essence") return process.env.MAIL_INJ_E || "magvl4gleize@durandservices.fr";
  return process.env.MAIL_FALLBACK || "atelier@durandservices.fr";
}
function makeTransport() {
  const user = process.env.GMAIL_USER;
  const pass = String(process.env.GMAIL_PASS || "").replace(/["\s]/g, "");
  return nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
}

/* ───────────────────────── Routes API ───────────────────────── */

// Soumission du formulaire : enregistre le dossier dans le JSON FTP (pas de PDF FTP)
router.post("/api/submit", express.json(), async (req, res) => {
  try {
    const raw = req.body && "payload" in req.body ? req.body.payload : req.body;
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;

    await pullCounterFromFtp();
    await pullCasesFromFtp();

    const no = await nextCaseNo();
    const header = data.header || {};
    const service = header.service || "";
    const client = header.client || "";
    const compte = header.compte || "";
    const magasin = header.magasin || "";
    const email   = header.email   || "";
    const dateISO = new Date().toISOString();

    // PDF pour email interne uniquement (en mémoire)
    let pdfBuffer = null;
    try { pdfBuffer = await drawPdfToBuffer(data); } catch {}

    // Email interne
    try {
      const to = resolveRecipients(service);
      const t = makeTransport();
      await t.sendMail({
        to,
        from: process.env.GMAIL_USER,
        subject: `[ATELIER] Dossier ${no} – ${service} – ${client}`,
        html: `
          <p><b>Dossier :</b> ${no}</p>
          <p><b>Service :</b> ${esc(service)}</p>
          <p><b>Magasin :</b> ${esc(magasin)}</p>
          <p><b>Client :</b> ${esc(client)}</p>
          <p><b>N° de compte :</b> ${esc(compte || "-")}</p>
          <p><b>Date :</b> ${esc(dateISO)}</p>
        `,
        attachments: pdfBuffer ? [{ filename: `ATELIER-${no}.pdf`, content: pdfBuffer, contentType: "application/pdf" }] : []
      });
    } catch (e) {
      console.warn("[ATELIER][MAIL] échec:", e?.message || e);
    }

    // On stocke un "snapshot" minimal pour la réimpression en ligne (pas de FTP PDF)
    const snapshot = {
      meta: data.meta || {},
      header,
      commentaires: data.commentaires || "",
      injecteur: data.injecteur || null,
      culasse: data.culasse || null
    };

    const entry = {
      no,
      date: dateISO,
      service,
      magasin,
      compte,
      client,
      email,
      status: "Pièce envoyée",
      snapshot // utilisé par /print-inline/:no
    };

    CASES.unshift(entry);
    writeJsonSafe(CASES_FILE, CASES);
    await pushCasesToFtp();

    // URL d’aperçu impression SANS FTP (HTML inline)
    const viewerUrl = `/atelier/print-inline/${encodeURIComponent(no)}`;
    res.json({ ok: true, no, viewerUrl });
  } catch (e) {
    console.error("[ATELIER] submit error:", e);
    res.status(400).json({ ok: false, error: "bad_payload" });
  }
});

// Liste des dossiers (rechargée depuis FTP)
router.get("/api/cases", async (_req, res) => {
  await pullCasesFromFtp();
  res.json({ ok: true, data: CASES });
});

// Mise à jour du statut + mail "Renvoyé"
router.post("/api/cases/:no/status", express.json(), async (req, res) => {
  try {
    const { no } = req.params;
    const { status } = req.body || {};
    const allowed = ["Pièce envoyée", "Réceptionné", "En cours de traitement", "Renvoyé"];
    if (!allowed.includes(status)) return res.status(400).json({ ok: false, error: "bad_status" });

    await pullCasesFromFtp();
    const it = CASES.find((x) => x.no === no);
    if (!it) return res.status(404).json({ ok: false, error: "not_found" });

    it.status = status;
    writeJsonSafe(CASES_FILE, CASES);
    await pushCasesToFtp();

    if (status === "Renvoyé" && it.email) {
      try {
        const t = makeTransport();
        const base =
          (process.env.PUBLIC_BASE || process.env.RENDER_EXTERNAL_URL || "").replace(/\/+$/,"");
        const link = `${base}/atelier/print-inline/${encodeURIComponent(it.no)}`;

        const subject = `Votre pièce a été renvoyée – Dossier ${it.no}`;
        const html = `
          <p>Bonjour,</p>
          <p>Nous vous informons que la pièce relative au <b>dossier ${esc(it.no)}</b> a été <b>renvoyée</b> au magasin <b>${esc(it.magasin || "-")}</b>.</p>
          <p>
            <b>Client :</b> ${esc(it.client || "-")}<br/>
            <b>N° de compte :</b> ${esc(it.compte || "-")}<br/>
            <b>Service :</b> ${esc(it.service || "-")}
          </p>
          <p>Fiche d’intervention : <a href="${esc(link)}">ouvrir l’aperçu</a></p>
          <p>Cordialement,</p>
          <p>Durand Services</p>
        `;
        await t.sendMail({ to: it.email, from: process.env.GMAIL_USER, subject, html });
      } catch (e) {
        console.warn("[ATELIER][MAIL][RENVOYE] échec:", e?.message || e);
      }
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("[ATELIER][STATUS] error:", e);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

/* ───────────────────────── Rendus impression (sans FTP) ───────────────────────── */

// Impression directe depuis un snapshot stocké
router.get("/print-inline/:no", async (req, res) => {
  try {
    await pullCasesFromFtp();
    const it = CASES.find((x) => x.no === req.params.no);
    if (!it || !it.snapshot) return res.status(404).type("text").send("Dossier introuvable.");
    const html = renderPrintHTML(it.snapshot);
    res.setHeader("Content-Security-Policy", FRAME_ANCESTORS);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  } catch (e) {
    console.error("[ATELIER] print-inline error:", e);
    return res.status(500).type("text").send("Erreur serveur");
  }
});

// Rendu impression legacy (POST avec payload)
router.post("/api/print-html", express.json(), (req, res) => {
  try {
    const raw = req.body && "payload" in req.body ? req.body.payload : req.body;
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;
    const html = renderPrintHTML(data);
    res.setHeader("Content-Security-Policy", FRAME_ANCESTORS);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  } catch (e) {
    console.error("[ATELIER] print-html error:", e);
    return res.status(400).type("text").send("Bad payload");
  }
});

/* ───────────────────────── Health ───────────────────────── */
router.get("/healthz", (_req, res) => res.type("text").send("ok"));

/* ───────────────────────── Boot sync ───────────────────────── */
await pullCounterFromFtp();
await pullCasesFromFtp();

export default router;
