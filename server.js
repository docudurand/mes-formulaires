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
import ExcelJS from "exceljs";

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
import kilometrageRouter from "./routes/kilometrage.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();
app.set("trust proxy", 1);
app.use(cors());
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

function fmtFR(dt, { withTime = true } = {}) {
  if (!dt) return "";
  const raw = String(dt);
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) {
    return withTime ? raw.replace('T',' ').replace('Z','') : raw.split('T')[0];
  }
  if (withTime) {
    return d.toLocaleString('fr-FR', {
      timeZone: 'Europe/Paris',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    }).replace(',', '');
  } else {
    return d.toLocaleDateString('fr-FR', {
      timeZone: 'Europe/Paris',
      year: 'numeric', month: '2-digit', day: '2-digit'
    });
  }
}

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "https://mes-formulaires.onrender.com";

const SITE_RESP_EMAIL = (process.env.MAIL_CG || "").trim();

const RESP_SERVICE_BY_MAGASIN = {
  "GLEIZE": "dampichard2007@gmail.com",
};

function siteRespNameFor(_magasin) {
 return "";
}
function respServiceEmailFor(magasin) {
  const m = String(magasin || "").trim().toUpperCase();
  return (RESP_SERVICE_BY_MAGASIN[m] || "").trim();
}

app.use("/atelier", atelier);
app.use("/suivi-dossier", suiviDossier);
app.use("/presence", presences);
app.use("/api/kilometrage", kilometrageRouter);

const MAGASINS_EXPORT = ["ANNEMASSE","BOURGOIN","CHASSE SUR RHONE","CHASSIEU","GLEIZE","LA MOTTE SERVOLEX","MIRIBEL","PAVI","RENAGE","RIVES","SAINT-MARTIN-D'HERES","SEYNOD","ST EGREVE","ST-JEAN-BONNEFONDS"];

const pad2 = n => String(n).padStart(2,'0');
const ymd = d => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
const daysOfMonth = (ym) => { const [y,m] = ym.split('-').map(Number); const out=[]; for(let i=1;i<=new Date(y,m,0).getDate();i++) out.push(new Date(y,m-1,i)); return out; };
const dowLetter = d => ["D","L","M","M","J","V","S"][d.getDay()];

async function fetchMonthStoreJSON(req, ym, magasin){
  const base = `${req.protocol}://${req.get('host')}`;
  const url  = `${base}/presence/month-store?yyyymm=${encodeURIComponent(ym)}&magasin=${encodeURIComponent(magasin)}`;
  const headers = {};
  const tok = req.get('X-Admin-Token');
  if (tok) headers['X-Admin-Token'] = tok;
  const { data } = await axios.get(url, { headers, timeout: 30000 });
  return data || {};
}

app.get('/presence/export-month', async (req, res) => {
  try {
    const ym = String(req.query.yyyymm || '').trim();
    if (!/^\d{4}-\d{2}$/.test(ym)) return res.status(400).json({ error: 'Paramètre yyyymm invalide' });

    const ADMIN_PASS = process.env.PRESENCES_LEAVES_PASSWORD;
    if (ADMIN_PASS && req.get('X-Admin-Token') !== ADMIN_PASS) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Présences DSG';
    wb.created = new Date();

    const daysOfMonth = (ym) => { const [y,m]=ym.split('-').map(Number); const out=[]; for(let i=1;i<=new Date(y,m,0).getDate();i++) out.push(new Date(y,m-1,i)); return out; };
    const ymd = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const dowLetter = d => ["D","L","M","M","J","V","S"][d.getDay()];
    const days = daysOfMonth(ym);
    const isWE = d => d.getDay() === 0 || d.getDay() === 6;

    const C = {
      BLACK:'FF000000', WHITE:'FFFFFFFF',
      P:'FFE8F5EC', CP:'FFAE6FC9', R:'FF97F7D6', AB:'FFFECACA', AM:'FFDE5D5F', F:'FF5DDEC6',
      PSITE:'FFEBB926',
      EMPTY:'FFFFFFFF', NP:'FF000000'
    };
    const codeFill = (val) => {
      const v = String(val||'').trim().toUpperCase();
      if (!v) return { fgColor:{ argb:C.EMPTY } };
      if (C[v]) return { fgColor:{ argb:C[v] } };
      if (/^P\d+$/.test(v)) return { fgColor:{ argb:C.PSITE } };
      return { fgColor:{ argb:C.EMPTY } };
    };

    const thHeader = {
      font:{ bold:true, color:{ argb:C.BLACK } },
      alignment:{ horizontal:'center', vertical:'middle' },
      border:{ top:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'}, bottom:{style:'thin'} }
    };
    const tdStyle = {
      alignment:{ horizontal:'center', vertical:'middle' },
      border:{ top:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'}, bottom:{style:'thin'} }
    };

    const fetchMonthStoreJSON = async (req, ym, magasin) => {
      const base = `${req.protocol}://${req.get('host')}`;
      const url = `${base}/presence/month-store?yyyymm=${encodeURIComponent(ym)}&magasin=${encodeURIComponent(magasin)}`;
      const headers = {}; const tok = req.get('X-Admin-Token'); if (tok) headers['X-Admin-Token']=tok;
      const { data } = await axios.get(url, { headers, timeout: 30000 });
      return data || {};
    };

    const MAGASINS_EXPORT = [
      "ANNEMASSE","BOURGOIN","CHASSE SUR RHONE","CHASSIEU","GLEIZE",
      "LA MOTTE SERVOLEX","MIRIBEL","PAVI","RENAGE","RIVES",
      "SAINT-MARTIN-D'HERES","SEYNOD","ST EGREVE","ST-JEAN-BONNEFONDS"
    ];

    const norm = s => String(s||"").trim().replace(/\s+/g," ").toUpperCase();

    const labelsFromMonthFile = (file) => {
      const byNorm = new Map();
      Object.values(file || {}).forEach(rec=>{
        (rec?.data?.rows || []).forEach(r=>{
          const raw = String(r.label || "").trim();
          if (!raw) return;
          const k = norm(raw);
          if (!byNorm.has(k)) byNorm.set(k, raw.toUpperCase());
        });
      });
      return [...byNorm.values()];
    };

    const buildNames = (arr, file, excludeSet = new Set()) => {
      const listFromArray = (items) => items
        .map(p => {
          if (typeof p === 'string') return p.trim();
          const nom = (p?.nom ?? '').toString().toUpperCase();
          const prenom = (p?.prenom ?? '').toString();
          const s = `${nom} ${prenom}`.trim();
          return s || (p?.label||'').toString().trim();
        })
        .filter(Boolean);

      let names = Array.isArray(arr) ? listFromArray(arr) : [];
      if (!names.length && file) {
        const set = new Set();
        Object.values(file).forEach(d => {
          const rows = (d?.data?.rows)||[];
          rows.forEach(r => { const lbl=String(r.label||'').trim(); if (lbl) set.add(lbl); });
        });
        names = Array.from(set);
      }
      const seen = new Set();
      return names.filter(n => {
        const k = n.toUpperCase();
        if (excludeSet.has(k) || seen.has(k)) return false; seen.add(k); return true;
      });
    };

    const collectSlots = (labels, file) => {
      const set = new Set(); const order=[];
      labels.forEach(lbl=>{
        const key = String(lbl).trim().toUpperCase();
        Object.values(file).forEach(day=>{
          const rows = (day?.data?.rows)||[];
          const found = rows.find(r => String(r.label||'').trim().toUpperCase() === key);
          if (found) Object.keys(found.values||{}).forEach(s => { if(!set.has(s)){ set.add(s); order.push(s); } });
        });
      });
      return order.length ? order : ['Matin','A. Midi'];
    };

    for (const mag of MAGASINS_EXPORT) {
      const { file = {}, personnel = { employes:[], interims:[], livreurs:{} } } =
        await fetchMonthStoreJSON(req, ym, mag);

      const labelsEmp = buildNames(personnel.employes, file);
      const setEmp = new Set(labelsEmp.map(s => s.toUpperCase()));

      const labelsInt = buildNames(personnel.interims, file, setEmp);
      const setEmpInt = new Set([...setEmp, ...labelsInt.map(s => s.toUpperCase())]);

      const knownNow = new Set([
        ...Array.from(setEmpInt.values()),
        ...Object.keys(personnel.livreurs||{}).map(norm)
      ]);
      const histAll = labelsFromMonthFile(file);
      const labelsOld = histAll.filter(lbl => !knownNow.has(norm(lbl)));

      const slotsEmp = collectSlots(labelsEmp, file);
      const slotsInt = collectSlots(labelsInt, file);
      const slotsOld = collectSlots(labelsOld, file);

      const ws = wb.addWorksheet(mag.substring(0,31), { properties:{ defaultColWidth: 12 } });

      ws.getColumn(1).hidden = false;
      ws.getColumn(1).width = 30;

      const writeSection = (title, labels, slots) => {
        if (!labels.length) return;

        ws.addRow([title]).font = { bold:true };
        ws.addRow([]);

        const h1=['Nom / Ligne'], h2=[''], h3=[''];
        days.forEach(d => { h1.push(...Array(slots.length).fill(dowLetter(d))); h2.push(...Array(slots.length).fill(d.getDate())); h3.push(...slots); });
        [ws.addRow(h1), ws.addRow(h2), ws.addRow(h3)].forEach(r => r.eachCell(c => Object.assign(c,{ style: thHeader })));

        labels.forEach(lbl=>{
          const rowVals=[lbl];
          days.forEach(d=>{
            const rec = file[ymd(d)];
            let values={};
            if (rec?.data?.rows){
              const found = rec.data.rows.find(r => String(r.label||'').trim().toUpperCase() === String(lbl).trim().toUpperCase());
              values = found?.values || {};
            }
            slots.forEach(s => rowVals.push(String(values[s]||'').trim().toUpperCase()));
          });

          const rr = ws.addRow(rowVals);

          const c1 = rr.getCell(1);
          c1.alignment = { horizontal:'left', vertical:'middle' };
          c1.font = { bold:true, color:{ argb:C.BLACK } };
          c1.border = tdStyle.border;

          rr.eachCell((c, idx) => {
            if (idx === 1) return;
            c.alignment = tdStyle.alignment;
            c.border = tdStyle.border;

            const dayIdx = Math.floor((idx - 2) / slots.length);
            const d = days[dayIdx];

            if (d && isWE(d)) {
              c.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:C.BLACK } };
              c.font = { color:{ argb:C.WHITE }, bold:true };
            } else {
              const v = String(c.value||'').trim().toUpperCase();
              const fill = codeFill(v);
              c.fill = { type:'pattern', pattern:'solid', ...fill };
              c.font = { color:{ argb:C.BLACK } };
            }
          });
        });

        ws.addRow([]);
      };

      writeSection('EMPLOYÉS', labelsEmp, slotsEmp);
      writeSection('INTÉRIM',  labelsInt, slotsInt);
      writeSection('ANCIENNE TRAME', labelsOld, slotsOld);

      ws.getColumn(1).hidden = false;
      if (!ws.getColumn(1).width || ws.getColumn(1).width < 20) ws.getColumn(1).width = 30;
    }

    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Presences_${ym}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('export-month failed', err?.message || err);
    res.status(500).json({ error: 'Export impossible' });
  }
});

const FTP_ROOT_BASE = (process.env.FTP_BACKUP_FOLDER || "/").replace(/\/$/, "");
const PRES_ROOT     = `${FTP_ROOT_BASE}/presences`;
const ADJUST_LOG    = `${PRES_ROOT}/adjust_conges.jsonl`;

async function appendJSONL(client, remotePath, obj){
  const tmp = tmpFile("adj_"+Date.now()+".jsonl");
  try{
    try { await client.downloadTo(tmp, remotePath); } catch {}
    const dir = path.posix.dirname(remotePath);
    await client.ensureDir(dir);
    fs.appendFileSync(tmp, JSON.stringify(obj) + "\n", "utf8");
    await client.uploadFrom(tmp, remotePath);
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

app.post("/presence/adjust-conges", async (req, res) => {
  try{
    const { magasin, date, entries, adjustments } = req.body || {};
    const list = Array.isArray(entries) ? entries : (Array.isArray(adjustments) ? adjustments : null);
    if (!magasin || !Array.isArray(list)) {
      return res.status(400).json({ ok:false, error:"bad_request" });
    }

    const stamp = new Date().toISOString();
    const payload = { magasin, date: date || stamp.slice(0,10), entries: list, stamp, source:"front" };

    try{
      const client = await ftpClient();
      await appendJSONL(client, ADJUST_LOG, payload);
      try{ client.close(); }catch{}
    }catch(e){
      console.warn("[adjust-conges] persistence skipped:", e?.message||e);
    }

    const GS_URL = process.env.CP_APPS_SCRIPT_URL || process.env.APPS_SCRIPT_URL || undefined;
    const SUPPORTS_ADJUST = String(process.env.CP_GS_SUPPORTS_ADJUST || "0") === "1";

    if (GS_URL) {
      for (const e of list) {
        const delta = Number(e.delta || 0);
        if (!delta || !e) continue;

        const full = String(e.fullName || "").trim();
        const nom = (e.nom || (full.split(/\s+/)[0] || "")).trim();
        const prenom = (e.prenom || (full.split(/\s+/).slice(1).join(" ") || "")).trim();

        try {
          if (SUPPORTS_ADJUST) {
            await fetch(`${GS_URL}?action=adjustcp`, {
              method:"POST",
              headers: { "Content-Type":"application/json" },
              body: JSON.stringify({ magasin, nom, prenom, delta })
            });
          } else if (delta < 0) {
            await fetch(`${GS_URL}?action=deccp`, {
              method:"POST",
              headers: { "Content-Type":"application/json" },
              body: JSON.stringify({ magasin, nom, prenom, nbJours: Math.abs(delta) })
            });
          }
        } catch(err) {
          console.warn("[adjust-conges] GS relay failed for", nom, prenom, delta, err?.message||err);
        }
      }
    }

    return res.json({ ok:true });
  }catch(e){
    console.error("[adjust-conges]", e);
    return res.status(200).json({ ok:true, note:"no_persist" });
  }
});

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
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html", "htm"], index: false }));

console.log("[BOOT] public/conges ?", fs.existsSync(path.join(__dirname, "public", "conges")));
console.log("[BOOT] public/conges/index.html ?", fs.existsSync(path.join(__dirname, "public", "conges", "index.html")));
app.get("/conges/ping", (_req, res) => res.status(200).send("pong"));
app.get("/conges", (_req, res) => { res.sendFile(path.join(__dirname, "public", "conges", "index.html")); });

function esc(str = "") {
  return String(str)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function fmtDateFR(dateStr = "") {
  const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : dateStr;
}

const LEAVES_FILE   = `${PRES_ROOT}/leaves.json`;
const UNITS_DIR     = `${PRES_ROOT}/units`;

const PDF_DIR_PREFS = [
  `${FTP_ROOT_BASE}/presence/leave`,
  `${PRES_ROOT}/leave`,
];

const FTP_DEBUG = String(process.env.PRESENCES_FTP_DEBUG||"0")==="1";
const FTP_RETRYABLE = /ECONNRESET|Client is closed|ETIMEDOUT|ENOTCONN|EPIPE|426|425/i;

function tlsOptions(){
  const rejectUnauthorized = String(process.env.FTP_TLS_REJECT_UNAUTH||"1")==="1";
  const servername = process.env.FTP_HOST || undefined;
  return { rejectUnauthorized, servername };
}

async function ftpClient(){
  const client = new ftp.Client(45_000);
  if (FTP_DEBUG) client.ftp.verbose = true;

  client.prepareTransfer = ftp.enterPassiveModeIPv4;

  await client.access({
    host: process.env.FTP_HOST,
    user: process.env.FTP_USER,
    password: process.env.FTP_PASSWORD,
    port: process.env.FTP_PORT ? Number(process.env.FTP_PORT) : 21,
    secure: String(process.env.FTP_SECURE||"false")==="true",
    secureOptions: tlsOptions()
  });

  try {
    client.ftp.socket?.setKeepAlive?.(true, 10_000);
    client.ftp.timeout = 45_000;
  } catch {}

  return client;
}

function tmpFile(name){ return path.join(os.tmpdir(), name); }

async function dlJSON(client, remote){
  const out = tmpFile("lv_"+Date.now()+".json");
  for (let attempt=1; attempt<=4; attempt++){
    try{
      await client.downloadTo(out, remote);
      const txt = fs.readFileSync(out, "utf8");
      try{ fs.unlinkSync(out); }catch{}
      return JSON.parse(txt);
    }catch(e){
      if (String(e?.code) === "550") { try{ fs.unlinkSync(out); }catch{}; return null; }
      const msg = String(e?.message||"") + " " + String(e?.code||"");
      if (attempt === 4 || !FTP_RETRYABLE.test(msg)) {
        try{ fs.unlinkSync(out); }catch{}; return null;
      }
      try{ client.close(); }catch{}
      client = await ftpClient();
      await new Promise(r => setTimeout(r, 250*attempt));
    }
  }
  return null;
}

async function upJSON(client, remote, obj){
  const out = tmpFile("lv_up_"+Date.now()+".json");
  fs.writeFileSync(out, JSON.stringify(obj));
  const dir = path.posix.dirname(remote);

  for (let attempt=1; attempt<=4; attempt++){
    try{
      await client.ensureDir(dir);
      await client.uploadFrom(out, remote);
      try{ fs.unlinkSync(out); }catch{}
      return;
    }catch(e){
      const msg = String(e?.message||"") + " " + String(e?.code||"");
      if (attempt === 4 || !FTP_RETRYABLE.test(msg)) {
        try{ fs.unlinkSync(out); }catch{}
        console.error("[FTP upJSON] fail", { dir, remote, code: e?.code, msg: e?.message });
        throw e;
      }
      try{ client.close(); }catch{}
      client = await ftpClient();
      await new Promise(r => setTimeout(r, 300*attempt));
    }
  }
}

async function upText(client, remote, buf){
  const dir = path.posix.dirname(remote);
  const out = tmpFile("lv_file_"+Date.now());
  fs.writeFileSync(out, buf);

  for (let attempt=1; attempt<=4; attempt++){
    try{
      await client.ensureDir(dir);
      await client.uploadFrom(out, remote);
      try{ fs.unlinkSync(out); }catch{}
      return;
    }catch(e){
      const msg = String(e?.message||"") + " " + String(e?.code||"");
      if (attempt === 4 || !FTP_RETRYABLE.test(msg)) {
        try{ fs.unlinkSync(out); }catch{}
        throw e;
      }
      try{ client.close(); }catch{}
      client = await ftpClient();
      await new Promise(r => setTimeout(r, 300*attempt));
    }
  }
}

async function uploadPdfToPreferredDir(client, localTmpPath, destName){
  let lastErr;
  for (const d of PDF_DIR_PREFS){
    try{
      await client.ensureDir(d);
      const remote = `${d}/${destName}`;
      await client.uploadFrom(localTmpPath, remote);
      if (FTP_DEBUG) console.log("[FTP] PDF uploaded:", remote);
      return remote;
    }catch(e){
      lastErr = e;
      console.warn("[FTP] PDF upload failed in", d, "-", e?.code, e?.message);
    }
  }
  throw lastErr;
}

async function appendLeave(payload) {

  const leaveId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  let lastErr;

  for (let i = 0; i < 3; i++) {
    let client;
    try {
      client = await ftpClient();
      await client.ensureDir(PRES_ROOT);
      await client.ensureDir(UNITS_DIR);

      const arr = (await dlJSON(client, LEAVES_FILE)) || [];

      let item = arr.find(x => x.id === leaveId);
      if (!item) {
        item = {
          id: leaveId,
          createdAt: new Date().toISOString(),
          status: "pending",
          statusFr: "en attente",
          ...payload,
        };
        arr.push(item);
        await upJSON(client, LEAVES_FILE, arr);

        const safe = s => String(s || "")
          .normalize("NFKD").replace(/[^\w.-]+/g, "_").slice(0, 64);
        const base = `${item.createdAt.slice(0,10)}_${safe(item.magasin)}_${safe(item.nom)}_${safe(item.prenom)}_${item.id}.json`;
        await upText(client, `${UNITS_DIR}/${base}`, JSON.stringify(item, null, 2));
      }

      try { client.close(); } catch {}
      return item.id;
    } catch (e) {
      lastErr = e;
      try { client?.close(); } catch {}
      await new Promise(t => setTimeout(t, 400 * (i + 1)));
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

      const safe = (s) => String(s || "").normalize("NFKD").replace(/[^\w.-]+/g, "_").slice(0, 64);
      const base = `${arr[i].createdAt.slice(0,10)}_${safe(arr[i].magasin)}_${safe(arr[i].nom)}_${safe(arr[i].prenom)}_${arr[i].id}.json`;
      const unit = `${UNITS_DIR}/${base}`;
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

  const colLeft = 50;
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
  resp_service: { page: 0, x: 120, y: 130, w: 220, h: 70 },
  resp_site:    { page: 0, x: 390, y: 130, w: 220, h: 70 },
};
const NAME_COORDS = {
  resp_service: { page: 0, x: 120, y: 210, size: 12 },
  resp_site:    { page: 0, x: 390, y: 210, size: 12 },
};

app.post("/conges/api", async (req, res) => {
  try {
    const { magasin, nomPrenom, nom, prenom, service, nbJours, dateDu, dateAu, email, signatureData } = req.body || {};
    const errors = [];

    if (!magasin) errors.push("magasin");
    if (!service) errors.push("service");
    if (!email)   errors.push("email");

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

    if (errors.length) return res.status(400).json({ ok:false, error:"invalid_fields", fields:errors });

    const leaveId = await appendLeave({
      magasin, nom:_nom, prenom:_prenom, service, nbJours:n, dateDu, dateAu, email
    });

    const duFR = fmtDateFR(dateDu), auFR = fmtDateFR(dateAu);
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
    const tmp = tmpFile("leave_"+leaveId+".pdf");
    fs.writeFileSync(tmp, pdfBuffer);
    let remotePdfPath;
    try {
      remotePdfPath = await uploadPdfToPreferredDir(clientUp, tmp, `${leaveId}.pdf`);
    } finally {
      try { fs.unlinkSync(tmp); } catch {}
      try { clientUp.close(); } catch {}
    }

    const tokenService = crypto.randomBytes(16).toString("hex");
    const tokenSite    = crypto.randomBytes(16).toString("hex");
    await patchLeave(leaveId, {
      pdfPath: remotePdfPath,
      tokens: { resp_service: tokenService, resp_site: tokenSite }
    });

    const { GMAIL_USER, GMAIL_PASS, FROM_EMAIL } = process.env;
    if (!GMAIL_USER || !GMAIL_PASS) {
      console.warn("[CONGES] smtp_not_configured");
      return res.status(500).json({ ok:false, error:"smtp_not_configured" });
    }
    const cleanedPass = String(GMAIL_PASS).replace(/["\s]/g, "");
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: GMAIL_USER, pass: cleanedPass }
    });

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
        <a href="${esc(linkService)}" style="display:inline-block;padding:10px 14px;border-radius:8px;background:#1d4ed8;color:#fff;text-decoration:none">Signer (Responsable de service)</a>
        &nbsp;&nbsp;
        <a href="${esc(linkSite)}" style="display:inline-block;padding:10px 14px;border-radius:8px;background:#0f766e;color:#fff;text-decoration:none">Signer (Responsable de site)</a>
      </p>
      <p style="color:#6b7280">Chaque lien est personnel et utilisable une seule fois.</p>
    `;

    const toList = [ SITE_RESP_EMAIL, respServiceEmailFor(magasin) ].filter(Boolean);
    const toRecipients = toList.length ? toList.join(",") : email;

    await transporter.sendMail({
      to: toRecipients,
      from: `Demande jours de congés <${FROM_EMAIL || GMAIL_USER}>`,
      replyTo: email,
      subject,
      html,
      attachments: [{
        filename: `Demande-conges-${nomPrenomStr.replace(/[^\w.-]+/g, "_")}.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf"
      }],
    });

    res.json({ ok:true, id: leaveId });
  } catch (e) {
    console.error("[/conges/api] Erreur:", e);
    res.status(500).json({ ok:false, error:"send_failed" });
  }
});

app.get("/conges/sign/:id", async (req, res) => {
  const { id } = req.params;
  const role = String(req.query.role||"").trim();
  const token = String(req.query.token||"").trim();
  if (!["resp_service","resp_site"].includes(role) || !token) {
    return res.status(400).send("Lien invalide.");
  }

  const prefillName = "";

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
const prefillSiteName=${JSON.stringify(prefillName)};
const c=document.getElementById('pad'), ctx=c.getContext('2d'); let draw=false, pts=[];
function size(){ const img=new Image(); img.onload=()=>{ c.width=c.clientWidth; c.height=220; ctx.fillStyle="#fff"; ctx.fillRect(0,0,c.width,c.height); ctx.drawImage(img,0,0,c.width,c.height); }
img.src=c.toDataURL(); }
window.addEventListener('resize', size); size();
if(role==="resp_site"){ document.getElementById('fullName').value=prefillSiteName; }
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

    let remotePdf = item.pdfPath;
    if (!remotePdf) {
      for (const d of PDF_DIR_PREFS) {
        const candidate = `${d}/${id}.pdf`;
        try {
          const tmpCheck = tmpFile("chk_"+id+".pdf");
          await client.downloadTo(tmpCheck, candidate);
          try { fs.unlinkSync(tmpCheck); } catch {}
          remotePdf = candidate;
          break;
        } catch {}
      }
      if (!remotePdf) return res.status(404).json({ ok:false, error:"pdf_not_found" });
    }

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

    let signerName = String(fullName || "").trim();

    pg.drawText(signerName, { x: namePos.x, y: namePos.y, size: namePos.size, font, color: rgb(0,0,0) });
    const auditTxt = `${dayjs().format("YYYY-MM-DD HH:mm")} • ${signerName} • ${role}`;
    pg.drawText(auditTxt, { x: 40, y: 30, size: 8, font, color: rgb(0.25,0.25,0.25) });

    const out = await pdfDoc.save();
    fs.writeFileSync(tmpPdf, out);
    await client.uploadFrom(tmpPdf, remotePdf);
    try{ fs.unlinkSync(tmpPdf); }catch{}

    const patch = { tokens: { ...tokens, [role]: null } };
    if (role === "resp_service") patch.signedService = { at: new Date().toISOString(), by: signerName };
    if (role === "resp_site")    patch.signedSite    = { at: new Date().toISOString(), by: signerName };

    arr[i] = { ...item, ...patch, pdfPath: remotePdf };

    await upJSON(client, LEAVES_FILE, arr);

    const safe = s => String(s||"").normalize("NFKD").replace(/[^\w.-]+/g,"_").slice(0,64);
    const base = `${arr[i].createdAt.slice(0,10)}_${safe(arr[i].magasin)}_${safe(arr[i].nom)}_${safe(arr[i].prenom)}_${arr[i].id}.json`;
    await upText(client, `${UNITS_DIR}/${base}`, JSON.stringify(arr[i], null, 2));

    const bothSigned = !!(arr[i].signedService && arr[i].signedSite);

    if (bothSigned && !arr[i].finalMailSent) {
      try {
        const { GMAIL_USER, GMAIL_PASS, FROM_EMAIL } = process.env;
        const cleanedPass = String(GMAIL_PASS || "").replace(/["\s]/g, "");

        if (GMAIL_USER && cleanedPass) {
          const transporter = nodemailer.createTransport({
            service: "gmail",
            auth: { user: GMAIL_USER, pass: cleanedPass }
          });

          const tmpFinal = tmpFile("final_" + id + ".pdf");
          await client.downloadTo(tmpFinal, remotePdf);

          const demanderEmail = arr[i].email || "";
          const recipients = [ SITE_RESP_EMAIL, demanderEmail ].filter(Boolean).join(",");

          await transporter.sendMail({
            to: recipients,
            from: `Validation congés <${FROM_EMAIL || GMAIL_USER}>`,
            replyTo: demanderEmail || undefined,
            subject: `Acceptation — ${(arr[i].nom || "").toUpperCase()} ${arr[i].prenom || ""}`,
            html: `<p>Le document PDF a été <b>signé par les deux responsables</b>.</p>
                   <p>Employé : ${(arr[i].nom || "").toUpperCase()} ${arr[i].prenom || ""}<br>
                      Période : ${arr[i].dateDu} → ${arr[i].dateAu} • ${arr[i].nbJours || "?"} jour(s)</p>
                   <p>Signatures :<br>
					  Service : ${(arr[i].signedService?.by || "—")} — ${fmtFR(arr[i].signedService?.at, { withTime: false })}<br>
					  Site : ${(arr[i].signedSite?.by || "—")} — ${fmtFR(arr[i].signedSite?.at, { withTime: false })}
				   </p>`,
            attachments: [{
              filename: `Demande-conges-${(arr[i].nom || "").toUpperCase()}_${arr[i].prenom || ""}.pdf`,
              path: tmpFinal
            }]
          });

          try { fs.unlinkSync(tmpFinal); } catch {}

          arr[i].finalMailSent = { at: new Date().toISOString(), to: recipients };
          await upJSON(client, LEAVES_FILE, arr);
          await upText(client, `${UNITS_DIR}/${base}`, JSON.stringify(arr[i], null, 2));

          console.log("[CONGES] mail final envoyé à:", recipients);
        } else {
          console.warn("[CONGES] Mail final non envoyé (SMTP non configuré)");
        }
      } catch (e) {
        console.warn("[CONGES] Envoi mail final (double signature) a échoué:", e?.message || e);
      }
    }

    return res.json({ ok: true, accepted: bothSigned });
  } catch(e){
    console.error(e);
    return res.status(500).json({ ok:false, error:String(e?.message||e) });
  } finally {
    try { client?.close(); } catch {}
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
