import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import nodemailer from "nodemailer";

// --- setup paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Router
const router = express.Router();

// Autoriser l’embed depuis Wix (aperçu impression HTML)
const FRAME_ANCESTORS =
  "frame-ancestors 'self' https://documentsdurand.wixsite.com https://*.wixsite.com https://*.wix.com https://*.editorx.io;";
router.use((_req, res, next) => {
  res.removeHeader("X-Frame-Options");
  res.setHeader("Content-Security-Policy", FRAME_ANCESTORS);
  next();
});

// Static (UI formulaire + suivi)
const publicDir = path.join(__dirname, "public");
router.use(
  express.static(publicDir, {
    maxAge: "1h",
    setHeaders: (res, p) => {
      res.setHeader("Content-Security-Policy", FRAME_ANCESTORS);
      if (p.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
    },
  })
);
router.get("/", (_req, res) => {
  const f = path.join(publicDir, "index.html");
  if (fs.existsSync(f)) return res.sendFile(f);
  res.status(500).type("text").send("atelier/public/index.html introuvable.");
});

// --- Persistance locale des dossiers (plus de FTP pour les PDF)
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
let CASES = readJsonSafe(CASES_FILE, []);

// --- Mail
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_PASS = String(process.env.GMAIL_PASS || process.env.GMAIL_PASSWORD || "").replace(/["\s]/g, "");
function makeTransport() {
  return nodemailer.createTransport({ service: "gmail", auth: { user: GMAIL_USER, pass: GMAIL_PASS } });
}
function esc(s) { return String(s ?? "").replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
function resolveRecipients(service) {
  if (service === "Rectification Culasse") return process.env.MAIL_RC || "magvl4gleize@durandservices.fr";
  if (service === "Contrôle injection Diesel") return process.env.MAIL_INJ_D || "magvl4gleize@durandservices.fr";
  if (service === "Contrôle injection Essence") return process.env.MAIL_INJ_E || "magvl4gleize@durandservices.fr";
  return process.env.MAIL_FALLBACK || "atelier@durandservices.fr";
}
function siteLabelForService(service = "") {
  if (service === "Contrôle injection Essence") return "ST EGREVE";
  if (service === "Rectification Culasse" || service === "Contrôle injection Diesel") return "ST EGREVE";
  return "";
}

// --- Compteur de n° locaux
function pad5(n) { return String(n).padStart(5, "0"); }
async function nextCaseNo() {
  const cur = parseInt(readTextSafe(COUNTER_FILE, "0").trim(), 10) || 0;
  const nxt = (cur + 1) % 100000;
  writeTextSafe(COUNTER_FILE, String(nxt));
  return pad5(nxt);
}

// --- Impression HTML (iframe)
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

// --- API

// Créer un dossier (enregistre localement + mail au service). AUCUN PDF FTP.
router.post("/api/submit", express.json(), async (req, res) => {
  try {
    const raw = req.body && "payload" in req.body ? req.body.payload : req.body;
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;

    const no = await nextCaseNo();
    const header = data.header || {};
    const service = header.service || "";
    const client = header.client || "";
    const compte = header.compte || "";
    const magasin = header.magasin || "";
    const email   = header.email   || "";
    const dateISO = new Date().toISOString();

    // Mail interne (sans PJ)
    try {
      const to = resolveRecipients(service);
      if (GMAIL_USER && GMAIL_PASS && to) {
        const t = makeTransport();
        await t.sendMail({
          to,
          from: GMAIL_USER,
          subject: `[ATELIER] Dossier ${no} – ${service} – ${client}`,
          html: `
            <p><b>Dossier :</b> ${no}</p>
            <p><b>Service :</b> ${esc(service)}</p>
            <p><b>Magasin :</b> ${esc(magasin)}</p>
            <p><b>Client :</b> ${esc(client)}</p>
            <p><b>N° de compte :</b> ${esc(compte || "-")}</p>
            <p><b>Date :</b> ${esc(dateISO)}</p>
          `,
        });
      }
    } catch (e) {
      console.warn("[ATELIER][MAIL] échec:", e?.message || e);
    }

    // Enregistrement du dossier
    const entry = { no, date: dateISO, service, magasin, compte, client, email, status: "Pièce envoyée" };
    CASES.unshift(entry);
    writeJsonSafe(CASES_FILE, CASES);

    // On ne renvoie plus de viewerUrl/ftpPath
    res.json({ ok: true, no });
  } catch (e) {
    console.error("[ATELIER] submit error:", e);
    res.status(400).json({ ok: false, error: "bad_payload" });
  }
});

// Liste des dossiers pour le suivi
router.get("/api/cases", async (_req, res) => {
  CASES = readJsonSafe(CASES_FILE, CASES);
  res.json({ ok: true, data: CASES });
});

// Changement de statut + mail au demandeur si "Renvoyé"
router.post("/api/cases/:no/status", express.json(), async (req, res) => {
  try {
    const { no } = req.params;
    const { status } = req.body || {};
    const allowed = ["Pièce envoyée", "Réceptionné", "En cours de traitement", "Renvoyé"];
    if (!allowed.includes(status)) return res.status(400).json({ ok: false, error: "bad_status" });

    CASES = readJsonSafe(CASES_FILE, CASES);
    const it = CASES.find((x) => x.no === no);
    if (!it) return res.status(404).json({ ok: false, error: "not_found" });

    it.status = status;
    writeJsonSafe(CASES_FILE, CASES);

    if (status === "Renvoyé" && it.email && GMAIL_USER && GMAIL_PASS) {
      try {
        const t = makeTransport();
        const subject = `Votre pièce a été renvoyée – Dossier ${it.no}`;
        const html = `
          <p>Bonjour,</p>
          <p>Nous vous informons que la pièce relative au <b>dossier ${esc(it.no)}</b> a été <b>renvoyée</b> au magasin <b>${esc(it.magasin || "-")}</b>.</p>
          <p>
            <b>Client :</b> ${esc(it.client || "-")}<br/>
            <b>N° de compte :</b> ${esc(it.compte || "-")}<br/>
            <b>Service :</b> ${esc(it.service || "-")}
          </p>
          <p>Cordialement,<br/>Durand Services</p>
        `;
        await t.sendMail({ to: it.email, from: GMAIL_USER, subject, html });
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

// Page HTML imprimable (utilisée par l’iframe côté front)
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

router.get("/healthz", (_req, res) => res.type("text").send("ok"));

export default router;
