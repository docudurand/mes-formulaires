// stats de visites (local + FTP)

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import ftp from "basic-ftp";

// Chemins utilitaires
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dossier local pour le cache
const DATA_DIR = path.join(process.cwd(), "data");
const LOCAL_FILE = path.join(DATA_DIR, "visits.json");

// Emplacement FTP distant
const FTP_ROOT_BASE = (process.env.FTP_BACKUP_FOLDER || "/").replace(/\/$/, "");
const REMOTE_FILE = `${FTP_ROOT_BASE}/analytics/visits.json`;

// Cache en memoire
let cache = null;

// Date du jour AAAA-MM-JJ
function todayYMD() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Lecture locale
async function readLocal() {
  try {
    const txt = await fs.readFile(LOCAL_FILE, "utf8");
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

// Ecriture locale
async function writeLocal(obj) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(LOCAL_FILE, JSON.stringify(obj, null, 2), "utf8");
}

// Verifie si FTP configure
function ftpEnabled() {
  return !!(process.env.FTP_HOST && process.env.FTP_USER && process.env.FTP_PASSWORD);
}

// Ouvre un client FTP
async function ftpClient() {
  const client = new ftp.Client(45_000);

  client.prepareTransfer = ftp.enterPassiveModeIPv4;

  await client.access({
    host: process.env.FTP_HOST,
    user: process.env.FTP_USER,
    password: process.env.FTP_PASSWORD,
    port: process.env.FTP_PORT ? Number(process.env.FTP_PORT) : 21,
    secure: true,
    secureOptions: {
      rejectUnauthorized: false,
    },
  });

  return client;
}

// Telecharge le fichier distant
async function downloadRemote() {
  if (!ftpEnabled()) return null;

  const client = await ftpClient();
  const tmp = path.join(process.cwd(), "tmp_visits_download.json");

  try {
    const dir = path.posix.dirname(REMOTE_FILE);
    await client.ensureDir(dir);

    await client.downloadTo(tmp, REMOTE_FILE);

    const txt = await fs.readFile(tmp, "utf8");
    return JSON.parse(txt);
  } catch {
    return null;
  } finally {
    try { await fs.unlink(tmp); } catch {}
    try { client.close(); } catch {}
  }
}

// Upload le fichier distant
async function uploadRemote(obj) {
  if (!ftpEnabled()) return;

  const client = await ftpClient();
  const tmp = path.join(process.cwd(), "tmp_visits_upload.json");

  try {
    await fs.writeFile(tmp, JSON.stringify(obj, null, 2), "utf8");
    const dir = path.posix.dirname(REMOTE_FILE);
    await client.ensureDir(dir);
    await client.uploadFrom(tmp, REMOTE_FILE);
  } finally {
    try { await fs.unlink(tmp); } catch {}
    try { client.close(); } catch {}
  }
}

// Nettoie la structure de donnees
function normalize(data) {
  const out = data && typeof data === "object" ? data : {};
  if (!out.byDate || typeof out.byDate !== "object") out.byDate = {};
  if (!Number.isFinite(Number(out.total))) out.total = 0;
  if (!out.updatedAt) out.updatedAt = new Date().toISOString();
  return out;
}

// Init des stats
export async function initVisits() {
  const local = await readLocal();
  if (local) {
    cache = normalize(local);
    return cache;
  }

  const remote = await downloadRemote();
  if (remote) {
    cache = normalize(remote);
    await writeLocal(cache);
    return cache;
  }

  cache = normalize({ total: 0, byDate: {} });
  await writeLocal(cache);

  await uploadRemote(cache).catch(() => {});
  return cache;
}

// Incremente les visites (jour + total)
export async function recordVisit() {
  if (!cache) await initVisits();

  const ymd = todayYMD();
  cache.byDate[ymd] = Number(cache.byDate[ymd] || 0) + 1;
  cache.total = Number(cache.total || 0) + 1;
  cache.updatedAt = new Date().toISOString();

  await writeLocal(cache);
  await uploadRemote(cache).catch(() => {});
  return cache;
}

// Retourne le cache en memoire
export async function getVisits() {
  if (!cache) await initVisits();
  return cache;
}
