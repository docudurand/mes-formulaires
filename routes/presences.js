import express from "express";
import ftp from "basic-ftp";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";

const router = express.Router();

const FTP_ROOT = (process.env.FTP_BACKUP_FOLDER || "/").replace(/\/$/, "") + "/presences";
const MAGASINS = [
  "ANNEMASSE","BOURGOIN","CHASSE SUR RHONE","CHASSIEU","GLEIZE",
  "LA MOTTE SERVOLEX","MIRIBEL","PAVI","RENAGE","RIVES",
  "SAINT-MARTIN-D'HERES","SEYNOD","ST EGREVE","ST-JEAN-BONNEFONDS"
];
const ADMIN_PASS = process.env.CONGES_ADMIN_PASS || "";
const FTP_DEBUG = String(process.env.PRESENCES_FTP_DEBUG||"0")==="1";

const yyyymm = (dateStr) => String(dateStr).slice(0,7);
const tmpFile = (name) => path.join(os.tmpdir(), name);
const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));
const norm = s => String(s||"").trim().replace(/\s+/g," ").toUpperCase();
const daysInRange = (d1, d2) => {
  const out = [];
  let a = new Date(d1+"T00:00:00");
  const b = new Date(d2+"T00:00:00");
  while (a <= b) { out.push(a.toISOString().slice(0,10)); a = new Date(a.getTime()+86400000); }
  return out;
};
const isWeekend = (isoDate) => {
  const d = new Date(isoDate+"T00:00:00").getDay();
  return d===0 || d===6;
};

function tlsOptions(){
  const rejectUnauthorized = String(process.env.FTP_TLS_REJECT_UNAUTH||"1")==="1";
  const servername = process.env.FTP_HOST || undefined;
  return { rejectUnauthorized, servername };
}

async function openFtp(){
  const client = new ftp.Client(30_000);
  if (FTP_DEBUG) client.ftp.verbose = true;
  await client.access({
    host: process.env.FTP_HOST,
    user: process.env.FTP_USER,
    password: process.env.FTP_PASSWORD,
    port: process.env.FTP_PORT ? Number(process.env.FTP_PORT) : 21,
    secure: String(process.env.FTP_SECURE||"false") === "true",
    secureOptions: tlsOptions()
  });
  try { client.ftp.socket?.setKeepAlive?.(true, 10_000); } catch {}
  return client;
}

async function ensureDir(client, remoteDir){
  await client.ensureDir(remoteDir);
}
async function tryDownloadJSON(client, remotePath){
  const out = tmpFile("pres_"+Date.now()+".json");
  try{
    await client.downloadTo(out, remotePath);
    const txt = fs.readFileSync(out, "utf8");
    return JSON.parse(txt);
  }catch(e){
    if (FTP_DEBUG) console.warn("[PRES][FTP] download fail:", remotePath, e?.message||e);
    return null;
  }finally{
    try{ fs.unlinkSync(out); }catch{}
  }
}
async function writeJSON(client, remotePath, obj){
  const dir = path.posix.dirname(remotePath);
  await ensureDir(client, dir);
  const out = tmpFile("pres_"+Date.now()+".json");
  fs.writeFileSync(out, JSON.stringify(obj));
  await client.uploadFrom(out, remotePath);
  try{ fs.unlinkSync(out); }catch{}
}
async function withFtp(actionLabel, fn, retries=2){
  let lastErr;
  for (let attempt=0; attempt<=retries; attempt++){
    let client;
    try{
      client = await openFtp();
      const result = await fn(client);
      try{ client.close(); }catch{}
      return result;
    }catch(e){
      lastErr = e;
      try{ client?.close(); }catch{}
      if (attempt < retries){
        console.warn(`[PRES/FTP] ${actionLabel} tentative ${attempt+1} échouée:`, e?.message||e);
        await sleep(300 + attempt*500);
        continue;
      }
    }
  }
  throw lastErr;
}

router.get("/personnel", async (req, res) => {
  const magasin = String(req.query.magasin || "");
  const url = process.env.GS_PRESENCES_URL;
  if(url){
    try{
      const resp = await fetch(`${url}?action=personnel&magasin=${encodeURIComponent(magasin)}`);
      if(resp.ok){ return res.json(await resp.json()); }
    }catch(e){
      console.warn("[PRES] personnel fallback:", e?.message||e);
    }
  }
  return res.json({ employes:[], interims:[], livreurs:{} });
});

router.post("/save", express.json({limit:"2mb"}), async (req, res) => {
  try{
    const { magasin, date, data } = req.body||{};
    if(!magasin || !date) return res.status(400).json({error:"missing fields"});
    const remoteDir  = `${FTP_ROOT}/${yyyymm(date)}`;
    const remoteFile = `${remoteDir}/${magasin}.json`;

    console.log("[PRES] SAVE", { magasin, date, file: remoteFile, rows:(data?.rows?.length||0) });

    await withFtp("save", async (client)=>{
      const json = await tryDownloadJSON(client, remoteFile) || {};
      json[date] = { data, savedAt: new Date().toISOString() };
      await writeJSON(client, remoteFile, json);
    });

    console.log("[PRES] SAVE OK", { magasin, date });
    res.json({ ok:true });
  }catch(e){
    console.error("[PRES] save error", e);
    res.status(500).json({error:"save_failed", message: e?.message||String(e)});
  }
});

router.get("/day", async (req, res) => {
  const { magasin, date } = req.query;
  if(!magasin || !date) return res.status(400).json({error:"missing fields"});
  const remoteFile = `${FTP_ROOT}/${yyyymm(date)}/${magasin}.json`;
  console.log("[PRES] DAY", { magasin, date, file: remoteFile });

  try{
    const json = await withFtp("day", client => tryDownloadJSON(client, remoteFile));
    return res.json(json?.[date] || {});
  }catch(e){
    console.warn("[PRES] day read error", e?.message||e);
    return res.json({});
  }
});

router.get("/month", async (req, res) => {
  const month = String(req.query.yyyymm || "");
  if(!month) return res.status(400).json({error:"missing yyyymm"});
  console.log("[PRES] MONTH", { month });

  try{
    const files = {};
    await withFtp("month", async (client)=>{
      for(const m of MAGASINS){
        const json = await tryDownloadJSON(client, `${FTP_ROOT}/${month}/${m}.json`);
        files[m] = json || {};
      }
    });

    const personnel = {};
    for(const m of MAGASINS){
      try{
        if(process.env.GS_PRESENCES_URL){
          const resp = await fetch(`${process.env.GS_PRESENCES_URL}?action=personnel&magasin=${encodeURIComponent(m)}`);
          personnel[m] = resp.ok ? await resp.json() : {employes:[], interims:[], livreurs:{}};
        }else{
          personnel[m] = {employes:[], interims:[], livreurs:{}};
        }
      }catch{
        personnel[m] = {employes:[], interims:[], livreurs:{}};
      }
    }

    res.json({ yyyymm: month, files, personnel });
  }catch(e){
    console.error("[PRES] month error", e?.message||e);
    res.status(500).json({error:"month_failed"});
  }
});

router.get("/month-store", async (req, res) => {
  const month = String(req.query.yyyymm || "");
  const magasin = String(req.query.magasin || "");
  if(!month || !magasin) return res.status(400).json({error:"missing params"});
  console.log("[PRES] MONTH-STORE", { month, magasin });

  try{
    const payload = await withFtp("month-store", async (client)=>{
      const file = await tryDownloadJSON(client, `${FTP_ROOT}/${month}/${magasin}.json`) || {};
      let pers = {employes:[], interims:[], livreurs:{}};
      if(process.env.GS_PRESENCES_URL){
        try{
          const resp = await fetch(`${process.env.GS_PRESENCES_URL}?action=personnel&magasin=${encodeURIComponent(magasin)}`);
          if(resp.ok) pers = await resp.json();
        }catch{}
      }
      return { yyyymm: month, files: { [magasin]: file }, personnel: { [magasin]: pers } };
    });
    res.json(payload);
  }catch(e){
    console.error("[PRES] month-store error", e?.message||e);
    res.status(500).json({error:"month_store_failed"});
  }
});

router.get("/_diag", async (_req, res) => {
  try{
    const ok = await withFtp("diag", async (client)=>{
      await client.cd("/");
      return true;
    });
    res.json({ ok });
  }catch(e){
    res.status(500).json({ ok:false, error: e?.message||String(e) });
  }
});

router.post("/conges/api", express.json({limit:"5mb"}), async (req,res)=>{
  return handleLeaveSubmit(req,res);
});

router.post("/leaves/submit", express.json({limit:"5mb"}), async (req,res)=>{
  return handleLeaveSubmit(req,res);
});

async function handleLeaveSubmit(req,res){
  try{
    const { magasin, nom, prenom, service, nbJours, dateDu, dateAu, email, signatureData } = req.body||{};
    if(!magasin || !nom || !prenom || !dateDu || !dateAu) {
      return res.status(400).json({ ok:false, error:"missing fields" });
    }
    const ym = yyyymm(dateDu);
    const id = `${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
    const record = {
      id, magasin, nom, prenom, email: email||"", service: service||"",
      nbJours: Number(nbJours)||null, dateDu, dateAu,
      signatureData: signatureData||null,
      status: "pending", createdAt: new Date().toISOString()
    };
    const remoteFile = `${FTP_ROOT}/leaves/${ym}/${magasin}.json`;

    await withFtp("leaves-submit", async client=>{
      const bag = await tryDownloadJSON(client, remoteFile) || {};
      bag[id] = record;
      await writeJSON(client, remoteFile, bag);
    });

    console.log("[LEAVES] submit OK", { magasin, ym, id });

    return res.json({ ok:true, id });
  }catch(e){
    console.error("[LEAVES] submit error", e);
    return res.status(500).json({ ok:false, error:"submit_failed" });
  }
}

router.get("/leaves", async (req,res)=>{
  const pass = req.headers["x-pass"] || req.query.pass;
  if(!ADMIN_PASS || pass !== ADMIN_PASS) {
    return res.status(401).json({ ok:false, error:"unauthorized" });
  }
  const month = String(req.query.yyyymm||"");
  const magasin = String(req.query.magasin||"");
  if(!month || !magasin) return res.status(400).json({ ok:false, error:"missing params" });

  try{
    const remoteFile = `${FTP_ROOT}/leaves/${month}/${magasin}.json`;
    const bag = await withFtp("leaves-list", client=> tryDownloadJSON(client, remoteFile)) || {};
    const list = Object.values(bag).sort((a,b)=> (a.createdAt||"").localeCompare(b.createdAt||""));
    return res.json({ ok:true, list });
  }catch(e){
    console.error("[LEAVES] list error", e?.message||e);
    return res.status(500).json({ ok:false, error:"list_failed" });
  }
});

router.post("/leaves/decision", express.json({limit:"1mb"}), async (req,res)=>{
  const pass = req.headers["x-pass"] || req.query.pass;
  if(!ADMIN_PASS || pass !== ADMIN_PASS) {
    return res.status(401).json({ ok:false, error:"unauthorized" });
  }
  const { id, magasin, yyyymm: month, decision } = req.body||{};
  if(!id || !magasin || !month || !decision) return res.status(400).json({ ok:false, error:"missing fields" });
  if(!["accept","refuse"].includes(decision)) return res.status(400).json({ ok:false, error:"bad decision" });

  try{
    const leavesFile = `${FTP_ROOT}/leaves/${month}/${magasin}.json`;
    let record;
    await withFtp("leaves-decision", async client=>{
      const bag = await tryDownloadJSON(client, leavesFile) || {};
      record = bag[id];
      if(!record) throw new Error("leave_not_found");
      record.status = (decision==="accept") ? "accepted" : "refused";
      record.decidedAt = new Date().toISOString();
      bag[id] = record;
      await writeJSON(client, leavesFile, bag);
    });

    if (record && record.status === "accepted") {
      await applyCPRange(magasin, record);
    }

    console.log("[LEAVES] decision OK", { id, magasin, month, decision });
    return res.json({ ok:true });
  }catch(e){
    console.error("[LEAVES] decision error", e?.message||e);
    return res.status(500).json({ ok:false, error:"decision_failed" });
  }
});

async function applyCPRange(magasin, rec){
  const days = daysInRange(rec.dateDu, rec.dateAu);

  const byMonth = new Map();
  for(const d of days){
    const ym = yyyymm(d);
    if(!byMonth.has(ym)) byMonth.set(ym, []);
    byMonth.get(ym).push(d);
  }
  for(const [ym, dates] of byMonth.entries()){
    const remoteFile = `${FTP_ROOT}/${ym}/${magasin}.json`;
    await withFtp("leaves-applyCP", async client=>{
      const json = await tryDownloadJSON(client, remoteFile) || {};
      for(const d of dates){

        const fullName = `${rec.nom} ${rec.prenom||""}`.trim();
        const cur = json[d]?.data || { rows: [] };

        let row = cur.rows.find(r => norm(r.label) === norm(fullName));
        if(!row){
          row = { label: fullName, values: {} };
          cur.rows.push(row);
        }

        row.values["Matin"] = "CP";
        row.values["A. Midi"] = "CP";

        json[d] = { data: cur, savedAt: new Date().toISOString() };
      }
      await writeJSON(client, remoteFile, json);
    });
  }
}

export default router;