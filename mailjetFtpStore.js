import ftp from "basic-ftp";
import fs from "fs";
import path from "path";
import os from "os";
import net from "net";

const ROOT  = (process.env.FTP_BACKUP_FOLDER || "/").replace(/\/$/, "");
const MJ_DIR = `${ROOT}/mailjet`;

function tmp(name){ return path.join(os.tmpdir(), name); }

function isIp(host){
  return net.isIP(String(host || "").trim()) !== 0;
}

function tlsOptions(){
  const rejectUnauthorized = String(process.env.FTP_TLS_REJECT_UNAUTH || "1") !== "0";

  const host = String(process.env.FTP_HOST || "").trim();
  const servername = host && !isIp(host) ? host : undefined;

  return { rejectUnauthorized, servername };
}

async function ftpClient(){
  const client = new ftp.Client(30_000);
  client.ftp.verbose = String(process.env.FTP_DEBUG || "0") === "1";
  client.prepareTransfer = ftp.enterPassiveModeIPv4;

  const host = process.env.FTP_HOST;
  const user = process.env.FTP_USER;

  if (!host || !user) {
    throw new Error("FTP not configured (FTP_HOST/FTP_USER missing)");
  }

  const secure = String(process.env.FTP_SECURE || "false") === "true";

  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      await client.access({
        host,
        user,
        password: process.env.FTP_PASSWORD,
        port: Number(process.env.FTP_PORT || 21),
        secure,
        secureOptions: secure ? tlsOptions() : undefined,
      });

      try {
        client.ftp.socket?.setKeepAlive?.(true, 10_000);
        client.ftp.timeout = 30_000;
      } catch {}

      return client;
    } catch (e) {
      lastErr = e;

      const msg = String(e?.message || "");
      if (attempt === 1 && secure && msg.includes("issuer certificate")) {
        try {
          await client.access({
            host,
            user,
            password: process.env.FTP_PASSWORD,
            port: Number(process.env.FTP_PORT || 21),
            secure,
            secureOptions: { rejectUnauthorized: String(process.env.FTP_TLS_REJECT_UNAUTH || "1") !== "0" },
          });
          return client;
        } catch (e2) {
          lastErr = e2;
        }
      }

      try { client.close(); } catch {}
      await new Promise(r => setTimeout(r, 250 * attempt));
    }
  }

  throw lastErr;
}

export async function appendEvent(event){
  const day  = new Date().toISOString().slice(0,10);
  const file = `${MJ_DIR}/events_${day}.jsonl`;
  const tmpf = tmp("mj_evt_"+Date.now()+".jsonl");

  const client = await ftpClient();
  try{
    await client.ensureDir(MJ_DIR);
    try { await client.downloadTo(tmpf, file); } catch {}
    fs.appendFileSync(tmpf, JSON.stringify(event) + "\n", "utf8");
    await client.uploadFrom(tmpf, file);
  } finally {
    try { fs.unlinkSync(tmpf); } catch {}
    try { client.close(); } catch {}
  }
}

export async function saveSnapshot(snapshot){
  const tmpf = tmp("mj_snapshot_"+Date.now()+".json");
  fs.writeFileSync(tmpf, JSON.stringify(snapshot, null, 2), "utf8");

  const client = await ftpClient();
  try{
    await client.ensureDir(MJ_DIR);
    await client.uploadFrom(tmpf, `${MJ_DIR}/email_status.json`);
  } finally {
    try { fs.unlinkSync(tmpf); } catch {}
    try { client.close(); } catch {}
  }
}

export async function loadSnapshot(){
  const tmpf = tmp("mj_snapshot_load_"+Date.now()+".json");

  const client = await ftpClient();
  try{
    await client.downloadTo(tmpf, `${MJ_DIR}/email_status.json`);
    return JSON.parse(fs.readFileSync(tmpf, "utf8"));
  } catch {
    return {};
  } finally {
    try { fs.unlinkSync(tmpf); } catch {}
    try { client.close(); } catch {}
  }
}

export async function cleanupOld(days=30){
  const client = await ftpClient();
  try{
    const limit = Date.now() - days * 24 * 3600 * 1000;

    let list = [];
    try { list = await client.list(MJ_DIR); } catch { return; }

    for (const f of list) {
      const m = String(f.name || "").match(/events_(\d{4}-\d{2}-\d{2})\.jsonl$/);
      if (!m) continue;

      const t = new Date(m[1]).getTime();
      if (Number.isFinite(t) && t < limit) {
        try { await client.remove(`${MJ_DIR}/${f.name}`); } catch {}
      }
    }
  } finally {
    try { client.close(); } catch {}
  }
}
