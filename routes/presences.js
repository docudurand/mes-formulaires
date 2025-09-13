import express from "express";
import ftp from "basic-ftp";
import fs from "fs";
import path from "path";
import os from "os";

const router = express.Router();

const FTP_ROOT = (process.env.FTP_BACKUP_FOLDER || "/").replace(/\/$/, "") + "/presences";
const LEAVES_DIR = `${FTP_ROOT}/leaves`;               // stockage des demandes
const MAGASINS = [
  "ANNEMASSE","BOURGOIN","CHASSE SUR RHONE","CHASSIEU","GLEIZE",
  "LA MOTTE SERVOLEX","MIRIBEL","PAVI","RENAGE","RIVES",
  "SAINT-MARTIN-D'HERES","SEYNOD","ST EGREVE","ST-JEAN-BONNEFONDS"
];

const yyyymm = (dateStr) => String(dateStr).slice(0,7);
const yyyy   = (dateStr) => String(dateStr).slice(0,4);
const tmpFile = (name) => path.join(os.tmpdir(), name);
const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));
const FTP_DEBUG = String(process.env.PRESENCES_FTP_DEBUG||"0")==="1";

const NORM = s => String(s||"").trim().replace(/\s+/g," ").toUpperCase();

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

async function ensureDir(client, remoteDir){ await client.ensureDir(remoteDir); }

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

function* iterDates(fromISO, toISO){
  const a = new Date(fromISO), b = new Date(toISO);
  for (let d = new Date(a); d <= b; d.setDate(d.getDate()+1)){
    yield d.toISOString().slice(0,10);
  }
}

async function upsertCPForRange({ magasin, label, fromISO, toISO }){

  const normLabel = NORM(label);
  await withFtp("apply_cp", async (client)=>{

    const byMonth = {};
    for (const day of iterDates(fromISO, toISO)){
      const m = yyyymm(day);
      (byMonth[m] ||= []).push(day);
    }
    for (const m of Object.keys(byMonth)){
      const remoteFile = `${FTP_ROOT}/${m}/${magasin}.json`;
      const monthObj = await tryDownloadJSON(client, remoteFile) || {};
      for (const day of byMonth[m]){
        const rec = monthObj[day] || { data:{rows:[]}, savedAt:null };
        const rows = Array.isArray(rec.data?.rows) ? rec.data.rows : [];
        let row = rows.find(r => NORM(r.label) === normLabel);
        if (!row){
          row = { label, values:{} };
          rows.push(row);
        }
        row.values = row.values || {};
        row.values["Matin"]  = "CP";
        row.values["A. Midi"] = "CP";
        rec.data = { rows };
        rec.savedAt = new Date().toISOString();
        monthObj[day] = rec;
      }
      await writeJSON(client, remoteFile, monthObj);
    }
  });
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
  return res.json({
    employes: [{nom:"BARRET", prenom:"Olivier"},{nom:"PICHARD", prenom:"Damien"}],
    interims: [{nom:"PEREZ"}],
    livreurs: {
      "WARNING": ["Matin","A. Midi"],
      "NAVETTE NUIT ALL COURS": ["NUIT"],
      "C CHEZ VOUS": ["10H","12H","16H"]
    }
  });
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
          personnel[m] = {employes:[], interims:[], livreours:{}};
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

router.post("/leaves/record", express.json({limit:"1mb"}), async (req, res)=>{
  try{
    const { magasin, nom, prenom, service, nbJours, dateDu, dateAu, email } = req.body||{};
    if(!magasin || !nom || !prenom || !service || !dateDu || !dateAu) {
      return res.status(400).json({ok:false, error:"missing fields"});
    }
    const id = `${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    const year = yyyy(dateDu);
    const rec = {
      id, magasin, nom, prenom, service, email: email||"",
      du: dateDu, au: dateAu, nbJours: Number(nbJours)||null,
      status: "pending", createdAt: new Date().toISOString(), decidedAt: null
    };

    await withFtp("leaves_record", async (client)=>{
      const file = `${LEAVES_DIR}/${year}.json`;
      const json = await tryDownloadJSON(client, file) || {};
      json[id] = rec;
      await writeJSON(client, file, json);
    });

    console.log("[LEAVES] recorded", { id, magasin, nom, prenom, du:dateDu, au:dateAu });
    res.json({ ok:true, id });
  }catch(e){
    console.error("[LEAVES] record error", e?.message||e);
    res.status(500).json({ ok:false, error:"record_failed" });
  }
});

router.get("/leaves", async (req, res)=>{
  const pwd = String(req.query.pwd||"");
  const wantAll = String(req.query.all||"0")==="1";
  if (!process.env.LEAVES_PASS || pwd !== process.env.LEAVES_PASS){
    return res.status(401).json({ ok:false, error:"auth_required" });
  }
  try{
    const out = [];
    await withFtp("leaves_list", async (client)=>{
      await ensureDir(client, LEAVES_DIR);
      let entries=[];
      try{ entries = await client.list(LEAVES_DIR); }catch{}
      const files = entries.filter(e=>e.isFile && /^\d{4}\.json$/.test(e.name)).map(e=>`${LEAVES_DIR}/${e.name}`);
      if(files.length===0){
        const Y = new Date().getFullYear();
        for (let y=Y-2; y<=Y+1; y++){ files.push(`${LEAVES_DIR}/${y}.json`); }
      }
      for(const f of files){
        const json = await tryDownloadJSON(client, f);
        if(json) out.push(...Object.values(json));
      }
    });
    out.sort((a,b)=> String(b.createdAt).localeCompare(String(a.createdAt)));
    res.json({ ok:true, items: wantAll ? out : out });
  }catch(e){
    console.error("[LEAVES] list error", e?.message||e);
    res.status(500).json({ ok:false, error:"list_failed" });
  }
});

router.post("/leaves/:id/decision", express.json({limit:"1mb"}), async (req, res)=>{
  const { id } = req.params;
  const { decision, pwd } = req.body||{};
  if (!process.env.LEAVES_PASS || pwd !== process.env.LEAVES_PASS){
    return res.status(401).json({ ok:false, error:"auth_required" });
  }
  if(!id || !["accept","refuse"].includes(String(decision))){
    return res.status(400).json({ ok:false, error:"bad_params" });
  }
  try{
    let found=null, yearHit=null, fileHit=null, storeObj=null;
    await withFtp("leaves_decision_read", async (client)=>{
      const Y = new Date().getFullYear();
      const years = [Y-2, Y-1, Y, Y+1];
      for (const y of years){
        const f = `${LEAVES_DIR}/${y}.json`;
        const j = await tryDownloadJSON(client, f);
        if(j && j[id]){ found=j[id]; yearHit = y; fileHit=f; storeObj=j; break; }
      }
    });
    if(!found) return res.status(404).json({ ok:false, error:"not_found" });

    found.status = (decision==="accept" ? "accepted" : "rejected");
    found.decidedAt = new Date().toISOString();

    await withFtp("leaves_decision_write", async (client)=>{
      storeObj[id] = found;
      await writeJSON(client, fileHit, storeObj);
    });

    if(found.status === "accepted"){
      const label = `${found.nom} ${found.prenom||""}`.trim();
      await upsertCPForRange({ magasin: found.magasin, label, fromISO: found.du, toISO: found.au });
    }

    res.json({ ok:true, item: found });
  }catch(e){
    console.error("[LEAVES] decision error", e?.message||e);
    res.status(500).json({ ok:false, error:"decision_failed" });
  }
});

router.get("/_diag", async (_req, res) => {
  try{
    const ok = await withFtp("diag", async (client)=>{ await client.cd("/"); return true; });
    res.json({ ok });
  }catch(e){
    res.status(500).json({ ok:false, error: e?.message||String(e) });
  }
});

export default router;