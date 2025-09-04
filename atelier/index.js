import express from "express";
import axios from "axios";
import PDFDocument from "pdfkit";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import nodemailer from "nodemailer";
import * as ftp from "basic-ftp";
import { Readable, Writable } from "stream";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

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
    },
  })
);

router.get("/", (_req, res) => {
  const f = path.join(publicDir, "index.html");
  if (fs.existsSync(f)) return res.sendFile(f);
  res.status(500).type("text").send("atelier/public/index.html introuvable.");
});

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

const SECURE_MODE = String(process.env.FTP_SECURE || "explicit").toLowerCase();
const secure =
  SECURE_MODE === "implicit" ? "implicit" :
  (SECURE_MODE === "false" || SECURE_MODE === "0") ? false : true;

const secureOptions = {
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
      secureOptions,
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
  const stream = Readable.from(buffer);
  await client.uploadFrom(stream, remotePath);
}
async function ensureDirsForYear(client, base, year) {
  await client.ensureDir(`${base}/${year}`);
}

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

function esc(s) { return String(s ?? "").replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
function siteLabelForService(service = "") {
  if (service === "Contrôle injection Essence") return "ST EGREVE";
  if (service === "Rectification Culasse" || service === "Contrôle injection Diesel") return "ST EGREVE";
  return "";
}


async function drawPdfToBuffer(data, { caseNo } = {}) {
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
      const section = (t) => { doc.moveDown(1.8); doc.font("Helvetica-Bold").fontSize(15).fillColor(BLUE).text(t); doc.moveDown(0.8); doc.fillColor(TEXT).font("Helvetica").fontSize(12); };
      const kv = (k,v) => { doc.font("Helvetica-Bold").text(`${k} : `, { continued: true, lineGap: 7 }); doc.font("Helvetica").text(v || "-", { lineGap: 7 }); };
      const bullet = (t) => { doc.font("Helvetica-Bold").text(`• ${t}`, { lineGap: 6 }); };
      const subBullet = (t) => { doc.font("Helvetica").text(`- ${t}`, { indent: 22, lineGap: 6 }); };

      const logoX = 52, logoTop = 40, logoW = 110; let logoBottom = logoTop;
      if (meta.logoUrl) {
        try { const img = await axios.get(meta.logoUrl, { responseType: "arraybuffer" }); doc.image(Buffer.from(img.data), logoX, logoTop, { width: logoW }); logoBottom = logoTop + logoW; } catch {}
      }

      const titre = header.service || meta.titre || "Demande d’intervention";
      const usableW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const titleTop = 77;

      const siteLbl = siteLabelForService(header.service);
      if (siteLbl){
        doc.font("Helvetica-Bold").fontSize(12).fillColor(BLUE);
        doc.text(siteLbl, doc.page.margins.left, 30, { width: usableW, align: "right" });
        if (caseNo){
          doc.font("Helvetica").fontSize(11).fillColor(TEXT);
          doc.text(`Dossier : ${caseNo}`, doc.page.margins.left, 46, { width: usableW, align: "right" });
        }
      } else if (caseNo) {
        doc.font("Helvetica").fontSize(11).fillColor(TEXT);
        doc.text(`Dossier : ${caseNo}`, doc.page.margins.left, 30, { width: usableW, align: "right" });
      }

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

function resolveRecipients(service) {
  const fallback = process.env.MAIL_TO || process.env.MAIL_CG || "magvl4gleize@durandservices.fr";
  if (service === "Rectification Culasse")     return process.env.MAIL_RC    || fallback;
  if (service === "Contrôle injection Diesel") return process.env.MAIL_INJ_D || fallback;
  if (service === "Contrôle injection Essence")return process.env.MAIL_INJ_E || fallback;
  return fallback;
}
function makeTransport() {
  const user = process.env.GMAIL_USER;
  const pass = String(process.env.GMAIL_PASS || "").replace(/["\s]/g, "");
  return nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
}

const ALLOWED_STATUSES = ["Demande envoyé", "Pièce reçu", "Travaux en cours", "Renvoyé"];

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

    const snapshot = {
      meta: data.meta || {},
      header,
      commentaires: data.commentaires || "",
      injecteur: data.injecteur || null,
      culasse: data.culasse || null
    };

    let pdfBuffer = null;
    try { pdfBuffer = await drawPdfToBuffer(snapshot, { caseNo: no }); } catch {}

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

    const entry = {
      no,
      date: dateISO,
      service,
      magasin,
      compte,
      client,
      email,
      status: "Demande envoyé",
      snapshot
    };
    CASES.unshift(entry);
    writeJsonSafe(CASES_FILE, CASES);
    await pushCasesToFtp();

    const viewerUrl = `/atelier/view-pdf-inline/${encodeURIComponent(no)}`;
    res.json({ ok: true, no, viewerUrl });
  } catch (e) {
    console.error("[ATELIER] submit error:", e);
    res.status(400).json({ ok: false, error: "bad_payload" });
  }
});

router.get("/api/cases", async (_req, res) => {
  await pullCasesFromFtp();
  res.json({ ok: true, data: CASES });
});

router.post("/api/cases/:no/status", express.json(), async (req, res) => {
  try {
    const { no } = req.params;
    const { status } = req.body || {};
    if (!ALLOWED_STATUSES.includes(status)) return res.status(400).json({ ok: false, error: "bad_status" });

    await pullCasesFromFtp();
    const it = CASES.find((x) => x.no === no);
    if (!it) return res.status(404).json({ ok: false, error: "not_found" });

    it.status = status;
    writeJsonSafe(CASES_FILE, CASES);
    await pushCasesToFtp();

    if (status === "Renvoyé" && it.email) {
      try {
        const t = makeTransport();
        const base = (process.env.PUBLIC_BASE || process.env.RENDER_EXTERNAL_URL || "").replace(/\/+$/,"");
        const link = `${base}/atelier/view-pdf-inline/${encodeURIComponent(it.no)}`;

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

router.get("/pdf/:no", async (req, res) => {
  try {
    await pullCasesFromFtp();
    const it = CASES.find((x) => x.no === req.params.no);
    if (!it || !it.snapshot) return res.status(404).type("text").send("Dossier introuvable.");
    const pdf = await drawPdfToBuffer(it.snapshot, { caseNo: it.no });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="ATELIER-${it.no}.pdf"`);
    return res.end(pdf);
  } catch (e) {
    console.error("[ATELIER] pdf error:", e);
    return res.status(500).type("text").send("Erreur serveur");
  }
});

router.get("/view-pdf-inline/:no", (req, res) => {
  const no = String(req.params.no || "").trim();
  if (!no) return res.status(400).type("text").send("Numéro manquant");
  res.setHeader("Content-Security-Policy", FRAME_ANCESTORS);
  res.type("html").send(`<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Aperçu PDF</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;height:100%} #pdf{border:0;width:100%;height:100%}</style>
</head><body>
<iframe id="pdf" src="/atelier/pdf/${encodeURIComponent(no)}"></iframe>
<script>
  const f=document.getElementById('pdf');
  f.addEventListener('load',()=>{ try{ f.contentWindow.focus(); f.contentWindow.print(); }catch(e){} });
</script>
</body></html>`);
});

router.get("/healthz", (_req, res) => res.type("text").send("ok"));

await pullCounterFromFtp();
await pullCasesFromFtp();

export default router;
