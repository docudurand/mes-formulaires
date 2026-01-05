import fs from "fs";
import path from "path";
import crypto from "crypto";

const QUEUE_DIR = process.env.MAIL_QUEUE_DIR || path.resolve(process.cwd(), "mail-queue");
const READY_DIR = path.join(QUEUE_DIR, "ready");
const DONE_DIR = path.join(QUEUE_DIR, "done");
const FAIL_DIR = path.join(QUEUE_DIR, "failed");

const INDEX_FILE = path.join(QUEUE_DIR, "idem-index.json");

function mkdirp(p) {
  try {
    fs.mkdirSync(p, { recursive: true });
  } catch {}
}

mkdirp(QUEUE_DIR);
mkdirp(READY_DIR);
mkdirp(DONE_DIR);
mkdirp(FAIL_DIR);

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const s = fs.readFileSync(file, "utf8");
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, obj) {
  const tmp = file + "." + process.pid + "." + Date.now() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

function nowISO() {
  return new Date().toISOString();
}

export function getIdempotencyKey(req, fallback = "") {
  const h = req?.get?.("x-request-id") || req?.headers?.["x-request-id"];
  const b = req?.body?.requestId;
  const k = (h || b || fallback || "").toString().trim();
  return k || "";
}

export function enqueueMailJob({ idempotencyKey = "", mailOptions, formType = "unknown", meta = {}, cleanupPaths = [] }) {
  if (idempotencyKey) {
    const idx = readJson(INDEX_FILE, {});
    if (idx[idempotencyKey]) {
      return { ok: true, jobId: idx[idempotencyKey], deduped: true };
    }
  }

  const jobId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
  const job = {
    jobId,
    idempotencyKey: idempotencyKey || "",
    createdAt: nowISO(),
    updatedAt: nowISO(),
    status: "queued",
    attempts: 0,
    nextAttemptAt: Date.now(),
    payload: {
      mailOptions,
      formType,
      meta,
      cleanupPaths: Array.isArray(cleanupPaths) ? cleanupPaths : [],
    },
  };

  const jobPath = path.join(READY_DIR, `${jobId}.json`);
  writeJsonAtomic(jobPath, job);

  if (idempotencyKey) {
    const idx = readJson(INDEX_FILE, {});
    idx[idempotencyKey] = jobId;
    writeJsonAtomic(INDEX_FILE, idx);
  }

  return { ok: true, jobId, deduped: false };
}

export function listReadyJobs() {
  const files = fs.readdirSync(READY_DIR).filter((f) => f.endsWith(".json"));
  return files.map((f) => path.join(READY_DIR, f));
}

export function loadJob(jobFile) {
  return readJson(jobFile, null);
}

export function saveJob(jobFile, job) {
  job.updatedAt = nowISO();
  writeJsonAtomic(jobFile, job);
}

export function moveJob(jobFile, destFolder) {
  const base = path.basename(jobFile);
  const dest = path.join(destFolder, base);
  fs.renameSync(jobFile, dest);
  return dest;
}

export { READY_DIR, DONE_DIR, FAIL_DIR };