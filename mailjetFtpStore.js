import ftp from "basic-ftp";
import fs from "fs";
import path from "path";
import os from "os";

const ROOT = (process.env.FTP_BACKUP_FOLDER || "/").replace(/\/$/, "");
const MJ_DIR = `${ROOT}/mailjet`;

function tmp(name){ return path.join(os.tmpdir(), name); }

function tlsOptions(){
  const rejectUnauthorized = String(process.env.FTP_TLS_REJECT_UNAUTH || "1") !== "0";
  const servername = process.env.FTP_HOST || undefined;
  return { rejectUnauthorized, servername };
}

async function ftpClient(){
  const client = new ftp.Client(30_000);
  client.ftp.verbose = String(process.env.FTP_DEBUG || "0") === "1";

  client.prepareTransfer = ftp.enterPassiveModeIPv4;

  await client.access({
    host: process.env.FTP_HOST,
    user: process.env.FTP_USER,
    password: process.env.FTP_PASSWORD,
    port: Number(process.env.FTP_PORT || 21),
    secure: String(process.env.FTP_SECURE || "false") === "true",
    secureOptions: tlsOptions(),
  });

  try {
    client.ftp.socket?.setKeepAlive?.(true, 10_000);
    client.ftp.timeout = 30_000;
  } catch {}

  return client;
}

export async function appendEvent(event){
  const day = new Date().toISOString().slice(0,10);
  const file = `${MJ_DIR}/events_${day}.jsonl`;
  const tmpf = tmp("mj_evt_"+Date.now()+".jsonl");
  const client = await ftpClient();
  try{
    await client.ensureDir(MJ_DIR);
    try{ await client.downloadTo(tmpf, file); }catch{}
    fs.appendFileSync(tmpf, JSON.stringify(event) + "\n", "utf8");
    await client.uploadFrom(tmpf, file);
  }finally{
    try{ fs.unlinkSync(tmpf); }catch{}
    try{ client.close(); }catch{}
  }
}

export async function saveSnapshot(snapshot){
  const tmpf = tmp("mj_snapshot.json");
  fs.writeFileSync(tmpf, JSON.stringify(snapshot,null,2), "utf8");
  const client = await ftpClient();
  try{
    await client.ensureDir(MJ_DIR);
    await client.uploadFrom(tmpf, `${MJ_DIR}/email_status.json`);
  }finally{
    try{ fs.unlinkSync(tmpf); }catch{}
    try{ client.close(); }catch{}
  }
}

export async function loadSnapshot(){
  const tmpf = tmp("mj_snapshot_load.json");
  const client = await ftpClient();
  try{
    await client.downloadTo(tmpf, `${MJ_DIR}/email_status.json`);
    return JSON.parse(fs.readFileSync(tmpf,"utf8"));
  }catch{
    return {};
  }finally{
    try{ fs.unlinkSync(tmpf); }catch{}
    try{ client.close(); }catch{}
  }
}

export async function cleanupOld(days=30){
  const client = await ftpClient();
  try{
    const list = await client.list(MJ_DIR);
    const limit = Date.now() - days*24*3600*1000;
    for(const f of list){
      const m = f.name.match(/events_(\d{4}-\d{2}-\d{2})/);
      if(m){
        const t = new Date(m[1]).getTime();
        if(t < limit){
          await client.remove(`${MJ_DIR}/${f.name}`);
        }
      }
    }
  }finally{
    try{ client.close(); }catch{}
  }
}