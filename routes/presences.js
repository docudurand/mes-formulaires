// routes/presences.js (ESM, FTPS robuste + logs)
import express from "express";
import ftp from "basic-ftp";
import fs from "fs";
import path from "path";
import os from "os";

const router = express.Router();

const FTP_ROOT = (process.env.FTP_BACKUP_FOLDER || "/").replace(/\/$/, "") + "/presences";
const MAGASINS = [
  "ANNEMASSE","BOURGOIN","CHASSE SUR RHONE","CHASSIEU","GLEIZE",
  "LA MOTTE SERVOLEX","MIRIBEL","PAVI","RENAGE","RIVES",
  "SAINT-MARTIN-D'HERES","SEYNOD","ST EGREVE","ST-JEAN-BONNEFONDS"
];

const yyyymm = (dateStr) => String(dateStr).slice(0,7);
const tmpFile = (name) => path.join(os.tmpdir(), name);
const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));
const FTP_DEBUG = String(process.env.PRESENCES_FTP_DEBUG||"0")==="1";

function tlsOptions(){
  // 0 => accepter cert auto-signé (Freebox)
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
    return null; // inexistant ou autre erreur => on traitera comme vide
  }finally{
    try{ fs.unlinkSync(out); }catch{}
  }
}

async function writeJSON(client, remotePath, obj){
  const dir = path.posix.dirname(remotePath);
  await ensureDir(client, dir);
  const out = tmpFile("pres_"+Date.now()+".json");
  fs.writeFileSync(out, JSON.stringify(obj)); // compact pour minimiser le poids
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

// --- Routes ---

// 1) Personnel (Google Apps Script)
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
  // Fallback aligné avec l'UI (colonnes Matin/A.Midi etc.)
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

// 2) Save jour (UNE seule route)
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

// 3) Prefill jour
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

// 4) Résumé mensuel
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

// 5) Diag (optionnel): tester connexion FTP
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