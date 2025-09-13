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
const LEAVES_FILE = `${FTP_ROOT}/leaves.json`;
const LEAVES_ADMIN_TOKEN = (process.env.PRESENCES_LEAVES_PASSWORD || "").trim();

const yyyymm = (dateStr="") => String(dateStr).slice(0,7);
const tmpFile = (name) => path.join(os.tmpdir(), name);
const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));
const FTP_DEBUG = String(process.env.PRESENCES_FTP_DEBUG||"0")==="1";
const isWE = (d) => { const x=d.getDay(); return x===0 || x===6; };

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
  }finally{ try{ fs.unlinkSync(out); }catch{} }
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

function authOk(req){
  const token = String(req.get("X-Admin-Token") || req.query.token || "").trim();
  return LEAVES_ADMIN_TOKEN && token && token === LEAVES_ADMIN_TOKEN;
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
  return res.json({ employes: [], interims: [], livreurs: {} });
});

router.post("/save", express.json({limit:"2mb"}), async (req, res) => {
  try{
    const { magasin, date, data } = req.body || {};
    if(!magasin || !/^\d{4}-\d{2}-\d{2}$/.test(String(date||"")))
      return res.status(400).json({ ok:false, error:"invalid_params" });

    await withFtp("save-day", async (client)=>{
      const month = yyyymm(date);
      const remoteFile = `${FTP_ROOT}/${month}/${magasin}.json`;
      const file = (await tryDownloadJSON(client, remoteFile)) || {};
      file[date] = { data, savedAt: new Date().toISOString() };
      await writeJSON(client, remoteFile, file);
    });

    res.json({ ok:true });
  }catch(e){
    console.error("[PRES] save error:", e?.message||e);
    res.status(500).json({ ok:false, error:"save_failed" });
  }
});

router.get("/leaves", async (req, res) => {
  if(!authOk(req)) return res.status(401).json({ ok:false, error:"auth_required" });
  try{
    const leaves = await withFtp("leaves-get", async (client)=>{
      const json = await tryDownloadJSON(client, LEAVES_FILE);
      return Array.isArray(json) ? json : [];
    });
    res.json({ ok:true, leaves });
  }catch(e){
    console.error("[LEAVES] get error:", e?.message||e);
    res.status(500).json({ ok:false, error:"leaves_read_failed" });
  }
});

router.post("/leaves/decision", express.json({limit:"1mb"}), async (req, res) => {
  if(!authOk(req)) return res.status(401).json({ ok:false, error:"auth_required" });
  const { id, decision, reason } = req.body || {};
  if(!id || !decision || !/^(accept|reject|cancel)$/i.test(decision)) {
    return res.status(400).json({ ok:false, error:"invalid_params" });
  }

  try{
    await withFtp("leaves-decision", async (client)=>{
      const leaves = (await tryDownloadJSON(client, LEAVES_FILE)) || [];
      const idx = leaves.findIndex(l=> String(l.id) === String(id));
      if(idx < 0) throw new Error("leave_not_found");
      const item = leaves[idx];

      const start = new Date(item.dateDu);
      const end   = new Date(item.dateAu);
      const label = `${(item.nom||"").toUpperCase()} ${item.prenom||""}`.trim();
      const DEF_SLOTS = ["Matin","A. Midi"];

      const act = decision.toLowerCase();

      if(act === "accept"){
        if(item.status !== "pending") throw new Error("already_decided");
        item.status = "accepted";
        item.reason = reason || "";
        item.decidedAt = new Date().toISOString();

        for(let d=new Date(start); d<=end; d.setDate(d.getDate()+1)){
          if(isWE(d)) continue;
          const dk = d.toISOString().slice(0,10);
          const month = yyyymm(dk);
          const remoteFile = `${FTP_ROOT}/${month}/${item.magasin}.json`;

          const file = (await tryDownloadJSON(client, remoteFile)) || {};
          const dayBlock = file[dk]?.data || { rows:[] };

          let row = (dayBlock.rows||[]).find(r => String(r.label).trim().toUpperCase() === label);
          if(!row){ row = { label, values:{} }; dayBlock.rows.push(row); }
          DEF_SLOTS.forEach(s=>{ row.values[s] = "CP"; });

          file[dk] = { data: dayBlock, savedAt: new Date().toISOString() };
          await writeJSON(client, remoteFile, file);
        }
      } else if (act === "reject"){
        if(item.status !== "pending") throw new Error("already_decided");
        item.status = "rejected";
        item.reason = reason || "";
        item.decidedAt = new Date().toISOString();
      } else if (act === "cancel"){
        if(item.status !== "accepted") throw new Error("not_accepted");
        item.status = "cancelled";
        item.cancelledAt = new Date().toISOString();
        item.reason = reason || item.reason || "";

        for(let d=new Date(start); d<=end; d.setDate(d.getDate()+1)){
          if(isWE(d)) continue;
          const dk = d.toISOString().slice(0,10);
          const month = yyyymm(dk);
          const remoteFile = `${FTP_ROOT}/${month}/${item.magasin}.json`;

          const file = (await tryDownloadJSON(client, remoteFile)) || {};
          const dayBlock = file[dk]?.data || { rows:[] };

          const row = (dayBlock.rows||[]).find(r => String(r.label).trim().toUpperCase() === label);
          if(row){
            let changed = false;
            DEF_SLOTS.forEach(s=>{
              if(row.values?.[s] === "CP"){ row.values[s] = ""; changed = true; }
            });
            if(changed){
              file[dk] = { data: dayBlock, savedAt: new Date().toISOString() };
              await writeJSON(client, remoteFile, file);
            }
          }
        }
      }

      await writeJSON(client, LEAVES_FILE, leaves);
    });

    res.json({ ok:true });
  }catch(e){
    console.error("[LEAVES] decision error:", e?.message||e);
    res.status(500).json({ ok:false, error: e?.message||"decision_failed" });
  }
});

export default router;