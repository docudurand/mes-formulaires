import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { transporter, fromEmail } from "../mailer.js";
import axios from "axios";
import { buildMailjetHeaders } from "../utils/mj.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const router = express.Router();

const GS_URL   = process.env.GS_ATELIER_URL || "";
const GS_SHEET = process.env.GS_ATELIER_SHEET || "Atelier";

if (!GS_URL) {
  console.warn("[ATELIER] ⚠️ GS_ATELIER_URL est vide. Les opérations Sheets/Apps Script échoueront.");
}

const http = axios.create({
  timeout: 20000,
  headers: { "User-Agent": "atelier-api/1.1 (+render)" }
});

router.get("/config.js", (_req, res) => {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(
    `window.__ATELIER_CFG = {
      GS_URL: ${JSON.stringify(GS_URL)},
      GS_SHEET: ${JSON.stringify(GS_SHEET)}
    };`
  );
});

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

function esc(s){ return String(s ?? "").replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':"&quot;"}[c])); }
function fmtJJMMYYYYdash(v){
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d)) return "";
  const p2 = (n) => String(n).padStart(2,"0");
  return `${p2(d.getDate())}-${p2(d.getMonth()+1)}-${d.getFullYear()}`;
}
function siteLabelForService(service = ""){
  if (service === "Arbre de Transmission") return "BOURGOIN";
  if (service === "Contrôle injection Essence") return "ST EGREVE";
  if (service === "Rectification Culasse" || service === "Contrôle injection Diesel") return "ST EGREVE";
  return "";
}

function sanitizeEstimation(v){
  if (v === 0 || v === "0") return "0";
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  return s;
}

const dataDir = path.join(__dirname, ".data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const COUNTER_FILE = path.join(dataDir, "counter.json");

function readJsonSafe(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const s = fs.readFileSync(file, "utf8");
    return s ? JSON.parse(s) : fallback;
  } catch { return fallback; }
}
function writeJsonSafe(file, obj) {
  try { fs.writeFileSync(file, JSON.stringify(obj, null, 2), "utf8"); } catch {}
}

async function nextDossierNumber(){
  let current = readJsonSafe(COUNTER_FILE, null)?.value ?? null;

  if (current === null && GS_URL) {
    try {
      const r = await http.get(GS_URL, { params: { action: "list_cases", sheet: GS_SHEET } });
      const list = (r.data && r.data.data) || [];
      const maxNo = list.reduce((m, x) => {
        const n = parseInt(String(x.no||'').replace(/\D/g,''), 10);
        return Number.isFinite(n) ? Math.max(m, n) : m;
      }, 0);
      current = maxNo;
    } catch {
      current = 0;
    }
  }

  if (current === null) current = 0;
  const next = Number(current) + 1;
  writeJsonSafe(COUNTER_FILE, { value: next });
  return String(next).padStart(5, "0");
}

async function gsListCases() {
  if (!GS_URL) return { ok: true, data: [] };
  const r = await http.get(GS_URL, {
    params: { action: "list_cases", sheet: GS_SHEET }
  });
  const json = r.data;
  if (json && Array.isArray(json.data)) return { ok:true, data: json.data };
  if (json && json.ok && Array.isArray(json.data)) return json;

  return { ok:true, data: [] };
}
async function gsAppendCase(entry) {
  if (!GS_URL) return { ok: false, error: "no_gs_url" };
  const r = await http.post(GS_URL, { action: "save_case", sheet: GS_SHEET, entry });
  return r.data;
}
async function gsUpdateStatus(no, status, dateStatusISO, estimation) {
  if (!GS_URL) return { ok: false, error: "no_gs_url" };
  const body = {
    action: "update_status",
    sheet: GS_SHEET,
    no,
    status,
    dateStatus: dateStatusISO
  };
  const est = sanitizeEstimation(estimation);
  if (est !== undefined) body.estimation = est;

  const r = await http.post(GS_URL, body);
  return r.data;
}

const DEST_ATELIER = {
  "Rectification Culasse": process.env.DEST_EMAIL_ATELIER_CULASSE,
  "Contrôle injection Diesel": process.env.DEST_EMAIL_ATELIER_DIESEL,
  "Contrôle injection Essence": process.env.DEST_EMAIL_ATELIER_ESSENCE,
  "Arbre de Transmission": process.env.DEST_EMAIL_ATELIER_ARBRE,
  "__DEFAULT__": process.env.MAIL_TO || process.env.MAIL_CG || ""
};

function destForService(service = ""){
  return DEST_ATELIER[service] || DEST_ATELIER.__DEFAULT__;
}

async function sendServiceMail(no, snapshot){
const t = transporter;
if (!t) {
  console.warn("[ATELIER][MAIL] SMTP not configured");
  return;
}

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
    ["Date demande", fmtJJMMYYYYdash(h.dateDemande) || "-"],
    ["Client", h.client || "-"],
    ["N° de compte client", h.compte || "-"],
    ["Téléphone client", h.telephone || "-"],
    ["Adresse mail magasinier/réceptionnaire", h.email || "-"],
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

    <div style="line-height:16px">&nbsp;</div>
    <div style="line-height:16px">&nbsp;</div>
  </div>
`.trim();

  // Generate Mailjet headers for tracking and record the "sent" status.
  const mjHeaders = buildMailjetHeaders(`atelier_service_${no}`);
  await t.sendMail({
    headers: mjHeaders,
    to,
    from: fromEmail,
    subject,
    html
  });
}

async function sendClientStatusMail(no, entry) {
  try {
    const t = transporter;
if (!t) {
  console.warn("[ATELIER][MAIL Client] SMTP not configured");
  return;
}

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
    <div style="line-height:16px">&nbsp;</div>
    <div style="line-height:16px">&nbsp;</div>
  </div>
`;
    // Generate Mailjet headers for tracking and record the "sent" status for client emails
    const mjHeaders = buildMailjetHeaders(`atelier_client_${no}`);
    await t.sendMail({ headers: mjHeaders, to, from: fromEmail, subject, html });
  } catch (e) {
    console.warn("[ATELIER][MAIL Client] échec:", e?.message || e);
  }
}

function renderPrintHTML(payload = {}, no = "", validationUrl = ""){
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

  let qrBlock = "";
  if (validationUrl) {
    const qrImgSrc =
      "https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=" +
      encodeURIComponent(validationUrl);
    qrBlock = `
  <div id="qr-validation"
       style="margin-top:24px;padding-top:12px;border-top:1px dashed #ccc;
              font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
    <div style="font-weight:700;margin-bottom:6px;">
      Validation de la réception de la pièce
    </div>
    <div style="font-size:12px;margin-bottom:6px;">
      Scannez ce QR Code pour valider la réception de la pièce.
    </div>
    <div style="display:flex;align-items:center;flex-wrap:wrap;gap:12px;">
      <img
        alt="QR Code de validation"
        width="160"
        height="160"
        src="${qrImgSrc}"
      />
    </div>
  </div>`;
  }


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
  .muted{ color:#6b7280; font-size:12px; }
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
      <div><span class="label">N° de compte client : </span>${esc(header.compte)}</div>
      <div><span class="label">Téléphone client : </span>${esc(header.telephone)}</div>
      <div><span class="label">Adresse mail magasinier/réceptionnaire : </span>${esc(header.email)}</div>
      <div><span class="label">Marque/Modèle : </span>${esc(header.vehicule)}</div>
      <div><span class="label">Immatriculation : </span>${esc(header.immat)}</div>
      <div><span class="label">Magasin d'envoi : </span>${esc(header.magasin)}</div>
      <div><span class="label">Date de la demande : </span>${esc(fmtJJMMYYYYdash(header.dateDemande))}</div>
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

  ${qrBlock}

  <script>window.onload=()=>{ setTimeout(()=>window.print(), 120); };</script>
</body>
</html>`;
}

router.post("/api/print-html", (req, res) => {
  try {
    const raw  = (req.body && "payload" in req.body) ? req.body.payload : req.body;
    const data = (typeof raw === "string") ? JSON.parse(raw) : raw;
    const no = (data && data.no) ? String(data.no).padStart(5,"0") : "";

    let validationUrl = "";
    if (no) {
      const baseUrl = `${req.protocol}://${req.get("host")}`.replace(/\/$/ ,"");
      validationUrl = `${baseUrl}/atelier/validation.html?no=${encodeURIComponent(no)}`;
    }

    const html = renderPrintHTML(data, no, validationUrl);
    res.setHeader("Content-Security-Policy", FRAME_ANCESTORS);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  } catch (e) {
    console.error("[ATELIER] print-html error:", e);
    return res.status(400).type("text").send("Bad payload");
  }
});

router.options("/api/submit", (_req, res) => res.status(204).end());
router.options("/api/cases", (_req, res) => res.status(204).end());
router.options("/api/cases/:no/status", (_req, res) => res.status(204).end());

router.post("/api/submit", async (req, res) => {
  try {
    const raw  = (req.body && "payload" in req.body) ? req.body.payload : req.body;
    const data = (typeof raw === "string") ? JSON.parse(raw) : raw;

    const no = await nextDossierNumber();
    const h  = (data && data.header) || {};

    const entry = {
      no,
      date: new Date().toISOString(),
      status: "Demande envoyé",
      estimation: "",
      snapshot: data,

      magasin: h.magasin || "",
      compte:  h.compte  || "",
      client:  h.client  || "",
      service: h.service || "",
      demandeDate: h.dateDemande || ""
    };

    const up = await gsAppendCase(entry);
    if (!up || up.ok !== true) {
      console.error("[ATELIER] Apps Script save_case a répondu:", up);
      return res.status(502).json({ ok:false, error:"upstream_save_failed", upstream: up });
    }

    try { await sendServiceMail(no, data); } catch (e) { console.warn("[ATELIER] mail atelier KO:", e?.message || e); }

    res.json({ ok: true, no });
  } catch (e) {
    console.error("[ATELIER] submit error:", e);
    res.status(500).json({ ok:false, error:"submit_failed" });
  }
});

router.get("/api/cases", async (_req, res) => {
  try {
    const r = await gsListCases();
    const data = (r && Array.isArray(r.data)) ? r.data : [];
    return res.json({ ok:true, data });
  } catch (e) {
    console.error("[ATELIER][CASES][GET] erreur:", e);
    res.status(500).json({ ok: false, data: [] });
  }
});

router.post("/api/cases/:no/status", async (req, res) => {
  try {
    const { no } = req.params;
    const { status, estimation } = req.body || {};
    if (!no || !status) return res.status(400).json({ ok:false, error:"bad_request" });

    const dateStatus = new Date().toISOString();
    const up = await gsUpdateStatus(no, String(status), dateStatus, sanitizeEstimation(estimation));
    if (!up || up.ok !== true) {
      console.error("[ATELIER] Apps Script update_status a répondu:", up);
      return res.status(502).json({ ok:false, error:"upstream_update_failed", upstream: up });
    }

    const stNorm = String(status)
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/['’]/g, "")
      .toLowerCase()
      .trim();

    if (stNorm === "renvoye" || stNorm === "piece renvoye a lagence") {
      try {
        const r = await gsListCases();
        const hit = (r && r.data || []).find(x => String(x.no) === String(no));
        if (hit) await sendClientStatusMail(no, hit);
      } catch (e) {
        console.warn("[ATELIER] mail client KO:", e?.message || e);
      }
    }

    res.json({ ok:true });
  } catch (e) {
    console.error("[ATELIER][CASES][STATUS] erreur:", e);
    res.status(500).json({ ok:false, error:"update_failed" });
  }
});

router.get("/healthz", (_req, res) => res.type("text").send("ok"));

export default router;
