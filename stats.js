import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import ftp from "basic-ftp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "data");

const COUNTERS_FILE  = path.join(DATA_DIR, "counters.json");
const PAGEVIEWS_FILE = path.join(DATA_DIR, "pageviews.json");

const FTP_HOST = process.env.FTP_HOST || "";
const FTP_PORT = Number(process.env.FTP_PORT || 21);
const FTP_USER = process.env.FTP_USER || "";
const FTP_PASSWORD = process.env.FTP_PASSWORD || "";
const FTP_SECURE = String(process.env.FTP_SECURE || "false").toLowerCase() === "true";

const FTP_BASE_DIR = process.env.FTP_BASE_DIR || "/Disque 1/sauvegardegarantie";

const REMOTE_COUNTERS  = "counters.json";
const REMOTE_PAGEVIEWS = "pageviews.json";

function canUseFTP() {
  return !!(FTP_HOST && FTP_USER && FTP_PASSWORD);
}

async function connectFTP() {
  const client = new ftp.Client();
  client.ftp.verbose = false;
  await client.access({
    host: FTP_HOST,
    port: FTP_PORT,
    user: FTP_USER,
    password: FTP_PASSWORD,
    secure: FTP_SECURE,
  });
  return client;
}

function defaultCounters() {
  return {
    piece:   { byYear: {}, total: 0 },
    piecepl: { byYear: {}, total: 0 },
    pneu:    { byYear: {}, total: 0 },
  };
}

function defaultPageviews() {
  return {
    pages: {
    },
  };
}

function mergeCounters(obj) {
  const base = defaultCounters();
  const o = (obj && typeof obj === "object") ? obj : {};
  for (const k of Object.keys(base)) {
    base[k].total = Number(o?.[k]?.total || 0);
    base[k].byYear = (o?.[k]?.byYear && typeof o[k].byYear === "object") ? o[k].byYear : {};
  }
  return base;
}

function mergePageviews(obj) {
  const base = defaultPageviews();
  const o = (obj && typeof obj === "object") ? obj : {};
  const pages = (o.pages && typeof o.pages === "object") ? o.pages : {};
  base.pages = {};
  for (const [p, v] of Object.entries(pages)) {
    if (!v || typeof v !== "object") continue;
    base.pages[p] = {
      total: Number(v.total || 0),
      byYear: (v.byYear && typeof v.byYear === "object") ? v.byYear : {},
    };
  }
  return base;
}

async function ensureLocalFile(filePath, fallbackObj) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, JSON.stringify(fallbackObj, null, 2), "utf-8");
  }
}

async function readJson(filePath, fallbackObj, mergeFn) {
  await ensureLocalFile(filePath, fallbackObj);
  const raw = await fs.readFile(filePath, "utf-8");
  try {
    return mergeFn(JSON.parse(raw));
  } catch {
    return mergeFn(fallbackObj);
  }
}

async function writeJson(filePath, obj) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(obj, null, 2), "utf-8");
}

async function downloadFromFTP(remoteName, localPath) {
  if (!canUseFTP()) return false;
  let client;
  try {
    client = await connectFTP();
    await client.ensureDir(FTP_BASE_DIR);
    await client.cd(FTP_BASE_DIR);

    const list = await client.list();
    const exists = list.some(f => f.name === remoteName);
    if (!exists) return false;

    await fs.mkdir(DATA_DIR, { recursive: true });
    await client.downloadTo(localPath, remoteName);
    return true;
  } catch (e) {
    console.warn(`[FTP] download ${remoteName} échoué:`, e?.message || e);
    return false;
  } finally {
    if (client) client.close();
  }
}

async function uploadToFTP(remoteName, localPath) {
  if (!canUseFTP()) return false;
  let client;
  try {
    client = await connectFTP();
    await client.ensureDir(FTP_BASE_DIR);
    await client.cd(FTP_BASE_DIR);
    await client.uploadFrom(localPath, remoteName);
    return true;
  } catch (e) {
    console.warn(`[FTP] upload ${remoteName} échoué:`, e?.message || e);
    return false;
  } finally {
    if (client) client.close();
  }
}

export async function initCounters() {
  await downloadFromFTP(REMOTE_COUNTERS, COUNTERS_FILE);
  await downloadFromFTP(REMOTE_PAGEVIEWS, PAGEVIEWS_FILE);

  await ensureLocalFile(COUNTERS_FILE, defaultCounters());
  await ensureLocalFile(PAGEVIEWS_FILE, defaultPageviews());
}

export async function recordSubmission(formType) {
  const type = String(formType || "").toLowerCase();
  if (!["piece", "piecepl", "pneu"].includes(type)) return;

  const year = String(new Date().getFullYear());
  const counters = await readJson(COUNTERS_FILE, defaultCounters(), mergeCounters);

  counters[type].byYear[year] = Number(counters[type].byYear[year] || 0) + 1;
  counters[type].total = Number(counters[type].total || 0) + 1;

  await writeJson(COUNTERS_FILE, counters);
  await uploadToFTP(REMOTE_COUNTERS, COUNTERS_FILE);

  console.log(`[COMPTEUR] +1 ${type} (${year})`);
}

export async function getCounters() {
  const counters = await readJson(COUNTERS_FILE, defaultCounters(), mergeCounters);

  const yearsSet = new Set([
    ...Object.keys(counters.piece.byYear || {}),
    ...Object.keys(counters.piecepl.byYear || {}),
    ...Object.keys(counters.pneu.byYear || {}),
  ]);
  const years = Array.from(yearsSet).sort((a, b) => Number(b) - Number(a));
  return { years, counters };
}

function normalizePath(p) {
  let s = String(p || "/").trim();
  if (!s.startsWith("/")) s = "/" + s;
  s = s.split("?")[0].split("#")[0];
  s = s.replace(/\/{2,}/g, "/");
  return s || "/";
}

export async function recordPageView(pathname) {
  const year = String(new Date().getFullYear());
  const p = normalizePath(pathname);

  const pv = await readJson(PAGEVIEWS_FILE, defaultPageviews(), mergePageviews);

  if (!pv.pages[p]) pv.pages[p] = { total: 0, byYear: {} };
  pv.pages[p].total = Number(pv.pages[p].total || 0) + 1;
  pv.pages[p].byYear[year] = Number(pv.pages[p].byYear[year] || 0) + 1;

  await writeJson(PAGEVIEWS_FILE, pv);
  await uploadToFTP(REMOTE_PAGEVIEWS, PAGEVIEWS_FILE);

  console.log(`[PAGEVIEW] +1 ${p} (${year})`);
}

export async function getPageViews() {
  const pv = await readJson(PAGEVIEWS_FILE, defaultPageviews(), mergePageviews);

  const yearsSet = new Set();
  for (const v of Object.values(pv.pages || {})) {
    for (const y of Object.keys(v.byYear || {})) yearsSet.add(y);
  }
  const years = Array.from(yearsSet).sort((a, b) => Number(b) - Number(a));

  return { years, pages: pv.pages || {} };
}