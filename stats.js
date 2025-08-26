import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import ftp from "basic-ftp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "data");
const COUNTERS_FILE = path.join(DATA_DIR, "counters.json");

const FTP_HOST = process.env.FTP_HOST || "";
const FTP_PORT = Number(process.env.FTP_PORT || 21);
const FTP_USER = process.env.FTP_USER || "";
const FTP_PASSWORD = process.env.FTP_PASSWORD || "";
const FTP_SECURE = String(process.env.FTP_SECURE || "false").toLowerCase() === "true";

const FTP_BASE_DIR = "/Disque 1/sauvegardegarantie";

const REMOTE_FILE = "counters.json";

function defaultCounters() {
  return {
    piece:   { byYear: {}, total: 0 },
    piecepl: { byYear: {}, total: 0 },
    pneu:    { byYear: {}, total: 0 },
  };
}

async function ensureLocalFiles() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(COUNTERS_FILE);
  } catch {
    await fs.writeFile(COUNTERS_FILE, JSON.stringify(defaultCounters(), null, 2), "utf-8");
    console.log("[COMPTEUR] counters.json local créé");
  }
}

async function readCountersLocal() {
  await ensureLocalFiles();
  const raw = await fs.readFile(COUNTERS_FILE, "utf-8");
  try {
    const obj = JSON.parse(raw);
    const base = defaultCounters();
    return { ...base, ...obj };
  } catch {
    return defaultCounters();
  }
}

async function writeCountersLocal(obj) {
  await fs.writeFile(COUNTERS_FILE, JSON.stringify(obj, null, 2), "utf-8");
}

function canUseFTP() {
  return FTP_HOST && FTP_USER && FTP_PASSWORD;
}

async function connectFTP() {
  const client = new ftp.Client(15_000);
  client.ftp.verbose = false;
  await client.access({
    host: FTP_HOST,
    port: FTP_PORT,
    user: FTP_USER,
    password: FTP_PASSWORD,
    secure: FTP_SECURE,
    secureOptions: { rejectUnauthorized: false },
  });
  return client;
}

async function uploadCountersToFTP() {
  if (!canUseFTP()) return;
  let client;
  try {
    client = await connectFTP();
    await client.ensureDir(FTP_BASE_DIR);
    await client.cd(FTP_BASE_DIR);
    await client.uploadFrom(COUNTERS_FILE, REMOTE_FILE);
    console.log("[COMPTEUR][FTP] Upload OK -> " + path.posix.join(FTP_BASE_DIR, REMOTE_FILE));
  } catch (e) {
    console.warn("[COMPTEUR][FTP] Upload échoué:", e?.message || e);
  } finally {
    if (client) client.close();
  }
}

async function downloadCountersFromFTP() {
  if (!canUseFTP()) return false;
  let client;
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    client = await connectFTP();
    await client.ensureDir(FTP_BASE_DIR);
    await client.cd(FTP_BASE_DIR);
    const list = await client.list();
    const exists = list.some(f => f.name === REMOTE_FILE);
    if (!exists) {
      console.log("[COMPTEUR][FTP] Aucun counters.json distant encore présent");
      return false;
    }
    await client.downloadTo(COUNTERS_FILE, REMOTE_FILE);
    console.log("[COMPTEUR][FTP] Download OK <- " + path.posix.join(FTP_BASE_DIR, REMOTE_FILE));
    return true;
  } catch (e) {
    console.warn("[COMPTEUR][FTP] Download échoué:", e?.message || e);
    return false;
  } finally {
    if (client) client.close();
  }
}

export async function initCounters() {
  const restored = await downloadCountersFromFTP();
  if (!restored) {
    await ensureLocalFiles();
  }
}

export async function recordSubmission(formType) {
  const type = String(formType || "").toLowerCase();
  if (!["piece", "piecepl", "pneu"].includes(type)) return;

  const now = new Date();
  const year = String(now.getFullYear());

  const counters = await readCountersLocal();
  counters[type].byYear[year] = (counters[type].byYear[year] || 0) + 1;
  counters[type].total = (counters[type].total || 0) + 1;

  await writeCountersLocal(counters);
  console.log(`[COMPTEUR] +1 ${type} (${year})`);

  await uploadCountersToFTP();
}

export async function getCounters() {
  const counters = await readCountersLocal();

  const yearsSet = new Set([
    ...Object.keys(counters.piece.byYear || {}),
    ...Object.keys(counters.piecepl.byYear || {}),
    ...Object.keys(counters.pneu.byYear || {}),
  ]);
  const years = Array.from(yearsSet).sort((a, b) => Number(b) - Number(a));

  return { years, counters };
}