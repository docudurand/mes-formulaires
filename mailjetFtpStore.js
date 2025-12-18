import ftp from "basic-ftp";
import fs from "fs";
import path from "path";
import os from "os";

const ROOT  = (process.env.FTP_BACKUP_FOLDER || "/").replace(/\/$/, "");
const MJ_DIR = `${ROOT}/mailjet`;

const FTP_DEBUG = String(process.env.FTP_DEBUG || process.env.PRESENCES_FTP_DEBUG || "0") === "1";
const FTP_RETRYABLE = /ECONNRESET|Client is closed|ETIMEDOUT|ENOTCONN|EPIPE|426|425|TLS/i;

function tmp(name) {
  return path.join(os.tmpdir(), name);
}

function isIp(host = "") {
  const h = String(host).trim();
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(h);
}

function tlsOptions() {
  const rejectUnauthorized = String(process.env.FTP_TLS_REJECT_UNAUTH || "1") !== "0";
  const host = String(process.env.FTP_HOST || "").trim();

  const servername = host && !isIp(host) ? host : undefined;

  return { rejectUnauthorized, servername };
}

async function ftpClient() {
  const client = new ftp.Client(30_000);
  client.ftp.verbose = FTP_DEBUG;

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

async function withFtp(fn) {
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    let client;
    try {
      client = await ftpClient();
      const result = await fn(client);
      try { client.close(); } catch {}
      return result;
    } catch (e) {
      lastErr = e;
      try { client?.close(); } catch {}
      const msg = String(e?.message || "") + " " + String(e?.code || "");
      if (attempt === 4 || !FTP_RETRYABLE.test(msg)) throw e;
      await new Promise(r => setTimeout(r, 250 * attempt));
    }
  }
  throw lastErr;
}

export async function appendEvent(event) {
  const day  = new Date().toISOString().slice(0, 10);
  const file = `${MJ_DIR}/events_${day}.jsonl`;
  const tmpf = tmp(`mj_evt_${Date.now()}.jsonl`);

  return withFtp(async (client) => {
    await client.ensureDir(MJ_DIR);

    try { await client.downloadTo(tmpf, file); } catch {}

    fs.appendFileSync(tmpf, JSON.stringify(event) + "\n", "utf8");
    await client.uploadFrom(tmpf, file);

    try { fs.unlinkSync(tmpf); } catch {}
    return true;
  }).finally(() => {
    try { fs.unlinkSync(tmpf); } catch {}
  });
}

export async function saveSnapshot(snapshot) {
  const tmpf = tmp("mj_snapshot.json");
  fs.writeFileSync(tmpf, JSON.stringify(snapshot, null, 2), "utf8");

  return withFtp(async (client) => {
    await client.ensureDir(MJ_DIR);
    await client.uploadFrom(tmpf, `${MJ_DIR}/email_status.json`);
    return true;
  }).finally(() => {
    try { fs.unlinkSync(tmpf); } catch {}
  });
}

export async function loadSnapshot() {
  const tmpf = tmp("mj_snapshot_load.json");

  try {
    return await withFtp(async (client) => {
      await client.downloadTo(tmpf, `${MJ_DIR}/email_status.json`);
      const txt = fs.readFileSync(tmpf, "utf8");
      try { fs.unlinkSync(tmpf); } catch {}
      return JSON.parse(txt);
    });
  } catch {
    try { fs.unlinkSync(tmpf); } catch {}
    return {};
  }
}

export async function cleanupOld(days = 30) {
  const limit = Date.now() - Number(days) * 24 * 3600 * 1000;

  return withFtp(async (client) => {
    let list = [];
    try {
      list = await client.list(MJ_DIR);
    } catch {
      return { deleted: 0, note: "MJ_DIR not found" };
    }

    let deleted = 0;
    for (const f of list) {
      const m = String(f.name || "").match(/events_(\d{4}-\d{2}-\d{2})/);
      if (!m) continue;
      const t = new Date(m[1]).getTime();
      if (Number.isFinite(t) && t < limit) {
        try {
          await client.remove(`${MJ_DIR}/${f.name}`);
          deleted++;
        } catch {}
      }
    }
    return { deleted };
  });
}