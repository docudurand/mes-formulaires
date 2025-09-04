import * as ftp from "basic-ftp";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Writable } from "stream";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function dequote(s) {
  return String(s ?? "").trim().replace(/^['"]|['"]$/g, "");
}

const DATA_DIR = path.join(__dirname, "data");
const LOCAL_FILE = path.join(DATA_DIR, "compteurs.json");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const FTP_HOST = dequote(process.env.FTP_HOST);
const FTP_PORT = Number(process.env.FTP_PORT || 21);
const FTP_USER = dequote(process.env.FTP_USER);
const FTP_PASS = dequote(process.env.FTP_PASS || process.env.FTP_PASSWORD || "");
const RAW_BACKUP_FOLDER = dequote(process.env.FTP_BACKUP_FOLDER || "/Disque 1/service");

const FTP_BACKUP_FOLDER = RAW_BACKUP_FOLDER.replace(/\/+$/, "");

const STATS_REMOTE_FILE = dequote(process.env.STATS_REMOTE_FILE || "counters.json");
const REMOTE_PATH = `${FTP_BACKUP_FOLDER}/${STATS_REMOTE_FILE}`;

const SECURE_MODE = String(process.env.FTP_SECURE || "explicit").toLowerCase();
const secure =
  SECURE_MODE === "implicit" ? "implicit" :
  (SECURE_MODE === "false" || SECURE_MODE === "0") ? false : true;

const secureOptions = {
  rejectUnauthorized: String(process.env.FTP_TLS_REJECT_UNAUTH || "1") !== "0",
};

function readLocal() {
  try {
    return JSON.parse(fs.readFileSync(LOCAL_FILE, "utf8"));
  } catch {
    return { years: [] };
  }
}
function writeLocal(obj) {
  try {
    fs.writeFileSync(LOCAL_FILE, JSON.stringify(obj, null, 2), "utf8");
  } catch (e) {
    console.warn("[COMPTEUR][LOCAL] Écriture échouée:", e?.message || e);
  }
}

async function withFtp(fn) {
  const client = new ftp.Client();
  client.ftp.verbose = false;
  try {
    await client.access({
      host: FTP_HOST,
      port: Number(FTP_PORT || (secure === "implicit" ? 990 : 21)),
      user: FTP_USER,
      password: FTP_PASS,
      secure,
      secureOptions,
    });
    return await fn(client);
  } finally {
    try { client.close(); } catch {}
  }
}

async function downloadRemoteToLocal() {
  return withFtp(async (client) => {
    try {
      const chunks = [];
      const sink = new Writable({
        write(chunk, _enc, cb) {
          chunks.push(Buffer.from(chunk));
          cb();
        }
      });
      await client.downloadTo(sink, REMOTE_PATH);
      const text = Buffer.concat(chunks).toString("utf8");
      const json = JSON.parse(text);
      if (json && typeof json === "object") {
        writeLocal(json);
      } else {
        console.warn("[COMPTEUR][FTP] JSON distant invalide, on conserve le local.");
      }
    } catch (e) {
      console.warn("[COMPTEUR][FTP] Download échoué:", e?.message || e);

    }
  });
}

async function uploadLocalToRemote() {
  const buf = Buffer.from(JSON.stringify(readLocal(), null, 2), "utf8");
  return withFtp(async (client) => {
    try {
      await client.ensureDir(FTP_BACKUP_FOLDER);
      await client.uploadFrom(buf, REMOTE_PATH);
    } catch (e) {
      console.warn("[COMPTEUR][FTP] Upload échoué:", e?.message || e);
    }
  });
}

export async function initCounters() {
  await downloadRemoteToLocal();
}

export async function getCounters() {
  await downloadRemoteToLocal();
  return readLocal();
}

export async function recordSubmission(type) {
  const data = readLocal();

  const key = String(type || "").toLowerCase();
  if (!(key in data)) data[key] = 0;
  data[key] = (Number(data[key]) || 0) + 1;

  writeLocal(data);
  await uploadLocalToRemote();
}