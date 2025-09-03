import express from "express";
import axios from "axios";
import PDFDocument from "pdfkit";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

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

const publicDir = path.join(__dirname, "public");
router.use(express.static(publicDir, {
  maxAge: "1h",
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

function esc(s){ return String(s ?? "").replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
function siteLabelForService(service = ""){
  if (service === "Contrôle injecteur Essence") return "RENAGE";
  if (service === "Rectification Culasse" || service === "Contrôle injecteur Diesel") return "ST EGREVE";
  return "";
}

function renderPrintHTML(payload = {}) {
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
  .header{ display:grid; grid-template-columns:130px 1fr; align-items:center; column-gap:18px; }
.header + .section{ margin-top:22px; }
  .logo{ width:130px; height:auto; object-fit:contain }
  .title{
  justify-self:center;
  text-align:center;
  margin:0;
  font-size:22px;
  font-weight:800;
  color:#0b4a6f;
  letter-spacing:.2px;
}
  .site-tag{ position:absolute; top:6mm; right:12mm; font-weight:800; color:#0b4a6f; font-size:14px; }
  .label{ font-weight:700 }
  .section{ margin-top:16px; }
.section h3{ margin:18px 0 10px; }
.two{ display:grid; grid-template-columns:1fr 1fr; gap:10px 28px; }
.bullet{ margin:5px 0; }
.subbullet{ margin-left:22px; margin-top:2px; }
.area{ border:1px solid #222; padding:10px; min-height:60px; white-space:pre-wrap; }
</style>
</head>
<body>
  ${siteLbl ? `<div class="site-tag">${esc(siteLbl)}</div>` : ''}
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

  ${(header.service === "Contrôle injecteur Diesel" || header.service === "Contrôle injecteur Essence") && injecteur ? `
  <div class="section">
    <h3>Détails Contrôle injecteur</h3>
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

const BLUE = "#0b4a6f", TEXT = "#000000";
function section(doc, t){
  doc.moveDown(1.8);
  doc.font("Helvetica-Bold").fontSize(15).fillColor(BLUE).text(t);
  doc.moveDown(0.8);
  doc.fillColor(TEXT).font("Helvetica").fontSize(12);
}
function kv(doc, k, v){
  doc.font("Helvetica-Bold").text(`${k} : `, { continued: true, lineGap: 7 });
  doc.font("Helvetica").text(v || "-", { lineGap: 7 });
}
function bullet(doc, t){ doc.font("Helvetica-Bold").text(`• ${t}`, { lineGap: 6 }); }
function subBullet(doc, t){ doc.font("Helvetica").text(`- ${t}`, { indent: 22, lineGap: 6 }); }

async function drawPdf(res, data){
  const meta = data.meta || {}, header = data.header || {}, culasse = data.culasse;
  const commentaires = (data.commentaires || "").trim();
  const injecteur = data.injecteur || null;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${(header.client || "Demande").replace(/[^\w\-]/g,"_")}.pdf"`);
  res.removeHeader("X-Frame-Options");
  res.setHeader("Content-Security-Policy", FRAME_ANCESTORS);

  const doc = new PDFDocument({ size:"A4", margins:{ top:50,left:52,right:52,bottom:54 } });
  doc.pipe(res);

  const logoX=52, logoTop=40, logoW=110; let logoBottom=logoTop;
  if (meta.logoUrl) {
    try {
      const img = await axios.get(meta.logoUrl, { responseType:"arraybuffer" });
      doc.image(Buffer.from(img.data), logoX, logoTop, { width: logoW });
      logoBottom = logoTop + logoW;
    } catch {}
  }

const titre   = header.service || meta.titre || "Demande d’intervention";
const usableW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
const titleTop = 62;

const siteLbl = siteLabelForService(header.service);
if (siteLbl){
  doc.font("Helvetica-Bold").fontSize(12).fillColor(BLUE);
  doc.text(siteLbl, doc.page.margins.left, 30, { width: usableW, align: "right" });
}

const HEADER_GAP = 12;
const visualLeft  = logoX + Math.round(logoW * 0.5) + HEADER_GAP;
const visualWidth = doc.page.width - doc.page.margins.right - visualLeft;

doc.font("Helvetica-Bold").fontSize(22).fillColor(BLUE);
doc.text(titre, visualLeft, titleTop, { width: visualWidth, align: "center", lineGap: 4 });

const titleBottom = titleTop + doc.heightOfString(titre, { width: visualWidth, align: "center" });

  doc.fillColor(TEXT).font("Helvetica").fontSize(12);
  doc.y = Math.max(logoBottom, titleBottom) + 72;

  section(doc,"Informations client");
  kv(doc,"Nom du client",header.client);
  kv(doc,"N° de compte",header.compte);
  kv(doc,"Téléphone",header.telephone);
  kv(doc,"Adresse mail",header.email);
  kv(doc,"Marque/Modèle",header.vehicule);
  kv(doc,"Immatriculation",header.immat);
  kv(doc,"Magasin",header.magasin);
  kv(doc,"Date de la demande",header.dateDemande);

  if (header.service === "Rectification Culasse" && culasse) {
    section(doc,"Détails Rectification Culasse");
    kv(doc,"Cylindre",culasse.cylindre);
    kv(doc,"Soupapes",culasse.soupapes);
    kv(doc,"Carburant",culasse.carburant);

    section(doc,"Opérations (cochées)");
    if (Array.isArray(culasse.operations) && culasse.operations.length) {
      culasse.operations.forEach(op=>{
        bullet(doc, op.libelle || op.ligne);
        if (Array.isArray(op.references) && op.references.length) {
          op.references.forEach(ref=>{
            const parts=[]; if(ref.reference) parts.push(ref.reference);
            if(ref.libelleRef) parts.push(ref.libelleRef);
            if(ref.prixHT || ref.prixHT===0) parts.push(`${ref.prixHT} € HT`);
            subBullet(doc, parts.join(" – "));
          });
        } else { subBullet(doc, "Aucune référence correspondante"); }
        doc.moveDown(0.2);
      });
    } else {
      doc.text("Aucune opération cochée.");
    }

    section(doc,"Pièces à Fournir");
    if (Array.isArray(culasse.piecesAFournir) && culasse.piecesAFournir.length)
      culasse.piecesAFournir.forEach(p => doc.text(`• ${p}`));
    else
      doc.text("Aucune pièce sélectionnée.");
  }

  if (header.service === "Contrôle injecteur Diesel" || header.service === "Contrôle injecteur Essence"){
    section(doc,"Détails Contrôle injecteur");
    kv(doc,"Type", (injecteur && injecteur.type) || "");
    kv(doc,"Nombre d’injecteurs", (injecteur && injecteur.nombre) || "");
  }

  if (commentaires) {
    section(doc, "Commentaires");
    doc.text(commentaires);
  }

  doc.end();
}

router.post("/api/print-html", (req, res) => {
  try {
    const raw  = (req.body && "payload" in req.body) ? req.body.payload : req.body;
    const data = (typeof raw === "string") ? JSON.parse(raw) : raw;
    const html = renderPrintHTML(data);
    res.setHeader("Content-Security-Policy", FRAME_ANCESTORS);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  } catch (e) {
    console.error("[ATELIER] print-html error:", e);
    return res.status(400).type("text").send("Bad payload");
  }
});

router.post("/api/print", async (req, res) => {
  try {
    const raw  = (req.body && "payload" in req.body) ? req.body.payload : req.body;
    const data = (typeof raw === "string") ? JSON.parse(raw) : raw;
    await drawPdf(res, data);
  } catch (e) {
    console.error("[ATELIER] PDF error:", e);
    res.status(500).send("PDF generation failed");
  }
});

const store = new Map();
const TTL_MS = 15 * 60 * 1000;
setInterval(()=>{ const now=Date.now(); for(const [id,it] of store){ if(now-it.created>TTL_MS) store.delete(id); } }, 60000);

router.post("/api/queue", (req, res) => {
  try {
    const raw  = (req.body && "payload" in req.body) ? req.body.payload : req.body;
    const data = (typeof raw === "string") ? JSON.parse(raw) : raw;
    const id = randomUUID();
    store.set(id, { data, created: Date.now() });
    res.json({ id });
  } catch (e) {
    console.error("[ATELIER] queue error:", e);
    res.status(400).json({ error: "Bad payload" });
  }
});

router.get("/viewer/:id", (req, res) => {
  res.setHeader("Content-Security-Policy", FRAME_ANCESTORS);
  const { id } = req.params;
  if (!store.has(id)) return res.status(404).type("text").send("Lien d’aperçu expiré.");
  res.type("html").send(`<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Aperçu</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;height:100%} #pdf{border:0;width:100%;height:100%}</style>
</head><body>
<iframe id="pdf" src="/atelier/pdf/${id}"></iframe>
<script>const f=document.getElementById('pdf');f.addEventListener('load',()=>{try{f.contentWindow.focus();f.contentWindow.print();}catch(e){}});</script>
</body></html>`);
});

router.get("/pdf/:id", async (req, res) => {
  const { id } = req.params;
  const it = store.get(id);
  if (!it) return res.status(404).type("text").send("PDF expiré.");
  try { await drawPdf(res, it.data || {}); }
  finally { store.delete(id); }
});

router.get("/healthz", (_req,res)=>res.type("text").send("ok"));

export default router;