import fs from "fs";
import { transporter } from "./mailer.js";
import { sendMailWithLog } from "./mailLog.js";
import { listReadyJobs, loadJob, saveJob, moveJob, DONE_DIR, FAIL_DIR } from "./mailQueue.js";

const POLL_MS = Number(process.env.MAIL_QUEUE_POLL_MS || 1500);
const MAX_ATTEMPTS = Number(process.env.MAIL_QUEUE_MAX_ATTEMPTS || 10);
const BASE_DELAY_MS = Number(process.env.MAIL_QUEUE_BASE_DELAY_MS || 2000);

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

  if (job.nextAttemptAt && Date.now() < job.nextAttemptAt) {
    return;
  }

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

(async function loop() {
  console.log("[INLINE_MAIL_WORKER] started");
  while (true) {
    try {
      const jobs = listReadyJobs();

      for (const jf of jobs) await processOne(jf);
    } catch (e) {
      console.warn("[INLINE_MAIL_WORKER] loop error:", e?.message || e);
    }
    await sleep(POLL_MS);
  }
})();
