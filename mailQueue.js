// file d'attente emails sur disque

import fs from "fs";
import path from "path";
import crypto from "crypto";

// Dossiers de stockage pour la file d'attente
const QUEUE_DIR = process.env.MAIL_QUEUE_DIR || path.resolve(process.cwd(), "mail-queue");
const READY_DIR = path.join(QUEUE_DIR, "ready");
const DONE_DIR = path.join(QUEUE_DIR, "done");
const FAIL_DIR = path.join(QUEUE_DIR, "failed");

// evite de creer 2 fois le meme job
const INDEX_FILE = path.join(QUEUE_DIR, "idem-index.json");

// Creation de dossier sans planter si existe deja
function mkdirp(p) {
  try {
    fs.mkdirSync(p, { recursive: true });
  } catch {}
}

mkdirp(QUEUE_DIR);
mkdirp(READY_DIR);
mkdirp(DONE_DIR);
mkdirp(FAIL_DIR);

// Lecture JSON simple
function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const s = fs.readFileSync(file, "utf8");
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
}

// ecriture atomique pour eviter un fichier coupe en deux
function writeJsonAtomic(file, obj) {
  const tmp = file + "." + process.pid + "." + Date.now() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

// Format date ISO pour le suivi
function nowISO() {
  return new Date().toISOString();
}

// Ici je recupere la cle d'idempotence
export function getIdempotencyKey(req, fallback = "") {
  const h = req?.get?.("x-request-id") || req?.headers?.["x-request-id"];
  const b = req?.body?.requestId;
  const k = (h || b || fallback || "").toString().trim();
  return k || "";
}

// Cette fonction sert a mettre un mail dans la file d'attente disque
export function enqueueMailJob({ idempotencyKey = "", mailOptions, formType = "unknown", meta = {}, cleanupPaths = [] }) {
  if (idempotencyKey) {
    const idx = readJson(INDEX_FILE, {});
    if (idx[idempotencyKey]) {
      return { ok: true, jobId: idx[idempotencyKey], deduped: true };
    }
  }

  const jobId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
  // Contenu du job qui sera traite par le worker
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

// Liste tous les jobs a traiter
export function listReadyJobs() {
  const files = fs.readdirSync(READY_DIR).filter((f) => f.endsWith(".json"));
  return files.map((f) => path.join(READY_DIR, f));
}

// Charge un job depuis son fichier
export function loadJob(jobFile) {
  return readJson(jobFile, null);
}

// Sauvegarde un job (maj dates)
export function saveJob(jobFile, job) {
  job.updatedAt = nowISO();
  writeJsonAtomic(jobFile, job);
}

// Deplace le job dans un autre dossier
export function moveJob(jobFile, destFolder) {
  const base = path.basename(jobFile);
  const dest = path.join(destFolder, base);
  fs.renameSync(jobFile, dest);
  return dest;
}

export { READY_DIR, DONE_DIR, FAIL_DIR };
