import express from "express";
import ftp from "basic-ftp";
import fs from "fs";
import path from "path";
import os from "os";

const router = express.Router();

const FTP_ROOT  = (process.env.FTP_BACKUP_FOLDER || "/").replace(/\/$/, "") + "/presences";
const LEAVES_DIR = `${FTP_ROOT}/leaves`;
const MAGASINS = [
  "ANNEMASSE","BOURGOIN","CHASSE SUR RHONE","CHASSIEU","GLEIZE",
  "LA MOTTE SERVOLEX","MIRIBEL","PAVI","RENAGE","RIVES",
  "SAINT-MARTIN-D'HERES","SEYNOD","ST EGREVE","ST-JEAN-BONNEFONDS"
];

const FTP_DEBUG = String(process.env.PRESENCES_FTP_DEBUG||"0")==="1";

const yyyymm = (dateStr) => String(dateStr).slice(0,7);
const pad = n => n<10? "0"+n : ""+n;
const tmpFile = (name) => path.join(os.tmpdir(), name);
const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));
const norm = s => String(s||"").normalize("NFD").replace(/\p{Diacritic}/gu,"").trim().replace(/\s+/g," ").toUpperCase();
const addDays = (d,n)=>{ const x=new Date(d); x.setDate(x.getDate()+n); return x; };
const iso = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

function* eachDayInclusive(d1Str, d2Str){
  let d = new Date(d1Str), end = new Date(d2Str);
  for(; d<=end; d = addDays(d,1)) yield new Date(d);
}

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
    secureOptions: tlsOptions(),
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

async function withFtp(label, fn, retries=2){
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
        console.warn(`[PRES/FTP] ${label} tentative ${attempt+1} échouée:`, e?.message||e);
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
          personnel[m] = {employes:[], interims:[], livreeurs:{}};
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
  if(!month || !magasin) return res.status(400).json({ok:false, error:"missing params"});
  console.log("[PRES] MONTH-STORE", { month, magasin });
  try{
    const files = {};
    await withFtp("month-store", async (client)=>{
      const json = await tryDownloadJSON(client, `${FTP_ROOT}/${month}/${magasin}.json`);
      files[magasin] = json || {};
    });

    const personnel = {};
    try{
      if(process.env.GS_PRESENCES_URL){
        const resp = await fetch(`${process.env.GS_PRESENCES_URL}?action=personnel&magasin=${encodeURIComponent(magasin)}`);
        personnel[magasin] = resp.ok ? await resp.json() : {employes:[], interims:[], livreurs:{}};
      }else{
        personnel[magasin] = {employes:[], interims:[], livreurs:{}};
      }
    }catch{
      personnel[magasin] = {employes:[], interims:[], livreurs:{}};
    }

    res.json({ yyyymm: month, files, personnel });
  }catch(e){
    console.error("[PRES] month-store error", e?.message||e);
    res.status(500).json({ok:false, error:"month_store_failed"});
  }
});

function checkPass(req){
  const header = req.get("x-pass");
  const q = req.query.pass;
  const expected = process.env.LEAVES_PASS || "";
  return expected && (header === expected || q === expected);
}

router.get("/leaves", async (req, res) => {
  const wantAll = String(req.query.all||"") === "1";
  const month = String(req.query.yyyymm || "");
  if(!checkPass(req)) return res.status(401).json({ok:false, error:"unauthorized"});

  try{
    const list = await withFtp("leaves-get", async (client)=>{
      if(wantAll){
        await ensureDir(client, LEAVES_DIR);
        const entries = await client.list(LEAVES_DIR).catch(()=>[]);
        const all = [];
        for(const e of entries){
          if(!e.isFile) continue;
          if(!/\.json$/i.test(e.name)) continue;
          const m = e.name.replace(/\.json$/i,"");
          const arr = await tryDownloadJSON(client, `${LEAVES_DIR}/${e.name}`);
          const listForMonth = Array.isArray(arr) ? arr : (arr?.list || []);
          listForMonth.forEach(x=>{
            if(!x.month) x.month = m;
            all.push(x);
          });
        }
        all.sort((a,b)=> String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
        return all;
      }else{
        if(!month) return [];
        const json = await tryDownloadJSON(client, `${LEAVES_DIR}/${month}.json`);
        const arr = Array.isArray(json) ? json : (json?.list || []);
        return arr.map(x=> x.month ? x : {...x, month});
      }
    });

    res.json({ ok:true, list: list || [] });
  }catch(e){
    console.error("[LEAVES] get error", e?.message||e);
    res.status(500).json({ ok:false, error:"leaves_get_failed" });
  }
});

router.post("/leaves/decision", express.json({limit:"1mb"}), async (req, res) => {
  try{
    if(!checkPass(req)) return res.status(401).json({ok:false, error:"unauthorized"});
    const { yyyymm: month, id, decision } = req.body||{};
    if(!month || !id || !["accept","refuse"].includes(decision)) {
      return res.status(400).json({ok:false, error:"missing params"});
    }
    const file = `${LEAVES_DIR}/${month}.json`;

    let target;
    await withFtp("leaves-decision", async (client)=>{
      const list = await tryDownloadJSON(client, file) || [];
      const idx = list.findIndex(x=> String(x.id)===String(id));
      if(idx<0) throw new Error("leave_not_found");
      list[idx].status = (decision==="accept" ? "accepted" : "refused");
      target = list[idx];
      await writeJSON(client, file, list);
    });

    if(decision==="accept" && target){
      try{
        await applyCPForLeave(target);
      }catch(e){
        console.warn("[LEAVES] apply CP failed:", e?.message||e);
      }
    }

    res.json({ ok:true });
  }catch(e){
    console.error("[LEAVES] decision error", e?.message||e);
    res.status(500).json({ ok:false, error: e?.message || "decision_failed" });
  }
});

async function applyCPForLeave(leave){
  const magasin = String(leave.magasin||"").trim();
  if(!magasin) throw new Error("missing magasin");
  const d1 = String(leave.dateDu||"").slice(0,10);
  const d2 = String(leave.dateAu||"").slice(0,10);
  if(!d1 || !d2) throw new Error("missing dates");

  const month = yyyymm(d1);
  const remoteFile = `${FTP_ROOT}/${month}/${magasin}.json`;
  const labelWanted = `${(leave.nom||"").trim()} ${(leave.prenom||"").trim()}`.trim();
  const keyWanted = norm(labelWanted);

  await withFtp("apply-cp", async (client)=>{
    const json = (await tryDownloadJSON(client, remoteFile)) || {};
    for(const d of eachDayInclusive(d1,d2)){
      const day = d.getDay();
      if(day===0 || day===6) continue;
      const dk = iso(d);
      const dayRec = json[dk] || { data: { rows: [] }, savedAt: new Date().toISOString() };
      const rows = dayRec.data.rows || [];

      let rowIndex = rows.findIndex(r => norm(r.label) === keyWanted);

      if(rowIndex < 0){
        const fallbackKey = norm(`(À rapprocher) ${labelWanted}`);
        rowIndex = rows.findIndex(r => norm(r.label) === fallbackKey);
      }

      if(rowIndex < 0){
        rows.push({ label: `(À rapprocher) ${labelWanted}`, values: {} });
        rowIndex = rows.length - 1;
      }

      const values = rows[rowIndex].values || {};
      if(values["Matin"]==null) values["Matin"] = "";
      if(values["A. Midi"]==null) values["A. Midi"] = "";
      values["Matin"]   = "CP";
      values["A. Midi"] = "CP";

      rows[rowIndex].values = values;
      dayRec.data.rows = rows;
      json[dk] = dayRec;
    }
    await writeJSON(client, remoteFile, json);
  });
}

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

export default router;