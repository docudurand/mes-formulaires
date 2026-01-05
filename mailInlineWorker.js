import fs from "fs";
import path from "path";
import { transporter } from "./mailer.js";
import { sendMailWithLog } from "./mailLog.js";
import {
  listReadyJobs,
  loadJob,
  saveJob,
  moveJob,
  DONE_DIR,
  FAIL_DIR,
} from "./mailQueue.js";

const POLL_MS = Number(process.env.MAIL_QUEUE_POLL_MS || 1500);
const MAX_ATTEMPTS = Number(process.env.MAIL_QUEUE_MAX_ATTEMPTS || 10);
const BASE_DELAY_MS = Number(process.env.MAIL_QUEUE_BASE_DELAY_MS || 2000);

const CLEANUP_EVERY_MS = Number(process.env.MAIL_QUEUE_CLEANUP_EVERY_MS || 6 * 60 * 60 * 1000); // 6h
const RETENTION_DAYS_DONE = Number(process.env.MAIL_QUEUE_RETENTION_DAYS_DONE || 30);
const RETENTION_DAYS_FAILED = Number(process.env.MAIL_QUEUE_RETENTION_DAYS_FAILED || 30);
const RETENTION_DAYS_IDEM = Number(process.env.MAIL_QUEUE_RETENTION_DAYS_IDEM || 60);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function nextDelay(attempt) {
  const d = BASE_DELAY_MS * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(d, 5 * 60 * 1000);
}

function safeUnlink(p) {
  try {
    if (p && fs.existsSync(p)) fs.unlinkSync(p);
  } catch {}
}

function short(s, n = 140) {
  const str = String(s ?? "");
  return str.length > n ? str.slice(0, n) + "…" : str;
}

function getTo(mailOptions) {
  const to = mailOptions?.to;
  if (Array.isArray(to)) return to.join(", ");
  return to || "";
}

async function processOne(jobFile) {
  const job = loadJob(jobFile);
  if (!job) {
    try {
      console.warn("[INLINE_MAIL_WORKER] invalid job file -> failed:", jobFile);
      moveJob(jobFile, FAIL_DIR);
    } catch {}
    return;
  }

  if (job.nextAttemptAt && Date.now() < job.nextAttemptAt) return;

  job.status = "sending";
  saveJob(jobFile, job);

  const mailOptions = job?.payload?.mailOptions || {};
  const to = getTo(mailOptions);
  const subject = mailOptions?.subject || "";
  const formType = job?.payload?.formType || "unknown";
  const attempts = job?.attempts || 0;

  console.log(
    "[INLINE_MAIL_WORKER] sending",
    job.jobId,
    "| formType=",
    formType,
    "| to=",
    short(to, 120),
    "| subject=",
    short(subject, 120),
    "| attempt=",
    attempts + 1
  );

  try {
    await sendMailWithLog(transporter, mailOptions, formType, job?.payload?.meta);

    (job?.payload?.cleanupPaths || []).forEach(safeUnlink);

    job.status = "sent";
    job.sentAt = new Date().toISOString();
    saveJob(jobFile, job);
    moveJob(jobFile, DONE_DIR);

    console.log("[INLINE_MAIL_WORKER] sent", job.jobId);
  } catch (e) {
    const msg = String(e?.message || e);

    job.attempts = (job.attempts || 0) + 1;
    job.lastError = msg;

    console.warn("[INLINE_MAIL_WORKER] error", job.jobId, "|", short(msg, 200));

    if (job.attempts >= MAX_ATTEMPTS) {
      job.failedAt = new Date().toISOString();
      saveJob(jobFile, job);
      moveJob(jobFile, FAIL_DIR);

      console.warn("[INLINE_MAIL_WORKER] moved to failed", job.jobId);
    } else {
      job.nextAttemptAt = Date.now() + nextDelay(job.attempts);
      saveJob(jobFile, job);

      console.log(
        "[INLINE_MAIL_WORKER] retry scheduled",
        job.jobId,
        "in",
        Math.round((job.nextAttemptAt - Date.now()) / 1000),
        "s"
      );
    }
  }
}

function safeReadJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8") || "null") ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, obj) {
  const tmp = file + "." + process.pid + "." + Date.now() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

function listJsonFiles(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

function fileAgeMs(file) {
  try {
    const st = fs.statSync(file);
    return Date.now() - st.mtimeMs;
  } catch {
    return 0;
  }
}

function deleteIfOlderThan(dir, retentionDays) {
  const cutoffMs = retentionDays * 24 * 60 * 60 * 1000;
  let removed = 0;

  for (const f of listJsonFiles(dir)) {
    if (fileAgeMs(f) > cutoffMs) {
      try {
        fs.unlinkSync(f);
        removed++;
      } catch {}
    }
  }
  return removed;
}

function cleanupIdemIndex(queueDir) {
  const file = path.join(queueDir, "idem-index.json");
  const idx = safeReadJson(file, {});
  if (!idx || typeof idx !== "object") return { kept: 0, removed: 0 };

  const allJobIds = new Set();

  const queueReady = path.join(queueDir, "ready");
  const queueDone = path.join(queueDir, "done");
  const queueFailed = path.join(queueDir, "failed");

  for (const dir of [queueReady, queueDone, queueFailed]) {
    for (const f of listJsonFiles(dir)) {
      allJobIds.add(path.basename(f).replace(/\.json$/i, ""));
    }
  }

  let removed = 0;
  const out = {};
  for (const [k, jobId] of Object.entries(idx)) {
    if (typeof jobId === "string" && allJobIds.has(jobId)) {
      out[k] = jobId;
    } else {
      removed++;
    }
  }

  writeJsonAtomic(file, out);
  return { kept: Object.keys(out).length, removed };
}

async function runCleanupOnce() {
  const queueDir = path.resolve(DONE_DIR, "..");

  const removedDone = deleteIfOlderThan(DONE_DIR, RETENTION_DAYS_DONE);
  const removedFailed = deleteIfOlderThan(FAIL_DIR, RETENTION_DAYS_FAILED);

  const idemFile = path.join(queueDir, "idem-index.json");
  const idemTooOld =
    fs.existsSync(idemFile) && fileAgeMs(idemFile) > RETENTION_DAYS_IDEM * 24 * 60 * 60 * 1000;

  const idemResult = idemTooOld ? cleanupIdemIndex(queueDir) : cleanupIdemIndex(queueDir);

  console.log(
    "[INLINE_MAIL_WORKER][CLEANUP]",
    "done_removed=",
    removedDone,
    "failed_removed=",
    removedFailed,
    "idem_kept=",
    idemResult.kept,
    "idem_removed=",
    idemResult.removed
  );
}

let nextCleanupAt = Date.now() + 15 * 1000;

(async function loop() {
  console.log("[INLINE_MAIL_WORKER] started");

  while (true) {
    try {
      const jobs = listReadyJobs();
      for (const jf of jobs) await processOne(jf);
    } catch (e) {
      console.warn("[INLINE_MAIL_WORKER] loop error:", e?.message || e);
    }

    // cleanup périodique
    if (Date.now() >= nextCleanupAt) {
      try {
        await runCleanupOnce();
      } catch (e) {
        console.warn("[INLINE_MAIL_WORKER][CLEANUP] error:", e?.message || e);
      }
      nextCleanupAt = Date.now() + CLEANUP_EVERY_MS;
    }

    await sleep(POLL_MS);
  }
})();
