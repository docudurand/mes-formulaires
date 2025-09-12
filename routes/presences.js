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

const yyyymm = (dateStr) => dateStr.slice(0,7);
const tmpFile = (name) => path.join(os.tmpdir(), name);

async function ftpClient(){
  const client = new ftp.Client(30_000);
  await client.access({
    host: process.env.FTP_HOST,
    user: process.env.FTP_USER,
    password: process.env.FTP_PASSWORD,
    port: process.env.FTP_PORT ? Number(process.env.FTP_PORT) : 21,
    secure: String(process.env.FTP_SECURE || "false") === "true",
    secureOptions: {
      rejectUnauthorized: String(process.env.FTP_TLS_REJECT_UNAUTH || "1") === "1"
    }
  });
  return client;
}
async function ensureDir(client, remoteDir){ await client.ensureDir(remoteDir); }

async function readJSONIfExists(client, remotePath){
  try{
    const dir  = path.posix.dirname(remotePath);
    const name = path.posix.basename(remotePath);
    const list = await client.list(dir);
    if(!list.find(e => e.name === name)) return null;
    const out = tmpFile("pres_"+Date.now()+".json");
    await client.downloadTo(out, remotePath);
    const txt = fs.readFileSync(out, "utf8");
    try{ fs.unlinkSync(out); }catch{}
    return JSON.parse(txt);
  }catch{ return null; }
}
async function writeJSON(client, remotePath, obj){
  const dir = path.posix.dirname(remotePath);
  await ensureDir(client, dir);
  const out = tmpFile("pres_"+Date.now()+".json");
  fs.writeFileSync(out, JSON.stringify(obj));
  await client.uploadFrom(out, remotePath);
  try{ fs.unlinkSync(out); }catch{}
}

router.get("/personnel", async (req, res) => {
  const magasin = String(req.query.magasin || "");
  const url = process.env.GS_PRESENCES_URL;
  if(url){
    try{
      const resp = await fetch(`${url}?action=personnel&magasin=${encodeURIComponent(magasin)}`);
      if(resp.ok){ return res.json(await resp.json()); }
    }catch{}
  }

  res.json({
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
    const { magasin, date, data } = req.body || {};
    if(!magasin || !date) return res.status(400).json({error:"missing fields"});
    const remoteDir  = `${FTP_ROOT}/${yyyymm(date)}`;
    const remoteFile = `${remoteDir}/${magasin}.json`;

    const client = await ftpClient();
    const json   = await readJSONIfExists(client, remoteFile) || {};
    json[date]   = { data, savedAt: new Date().toISOString() };
    await writeJSON(client, remoteFile, json);
    client.close();
    res.json({ ok:true });
  }catch(e){
    console.error("save error", e);
    res.status(500).json({error:"save_failed"});
  }
});

router.get("/day", async (req, res) => {
  const { magasin, date } = req.query;
  if(!magasin || !date) return res.status(400).json({error:"missing fields"});
  const client = await ftpClient();
  const remoteFile = `${FTP_ROOT}/${yyyymm(date)}/${magasin}.json`;
  const json = await readJSONIfExists(client, remoteFile);
  client.close();
  res.json(json?.[date] || {});
});

router.get("/month", async (req, res) => {
  const month = String(req.query.yyyymm || "");
  if(!month) return res.status(400).json({error:"missing yyyymm"});
  const client = await ftpClient();

  const files = {};
  for(const m of MAGASINS){
    const json = await readJSONIfExists(client, `${FTP_ROOT}/${month}/${m}.json`);
    files[m] = json || {};
  }

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

  client.close();
  res.json({ yyyymm: month, files, personnel });
});

export default router;