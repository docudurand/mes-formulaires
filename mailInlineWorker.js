import fs from "fs";
import { transporter } from "./mailer.js";
import { sendMailWithLog } from "./mailLog.js";
import { listReadyJobs, loadJob, saveJob, moveJob, DONE_DIR, FAIL_DIR } from "./mailQueue.js";

const POLL_MS = Number(process.env.MAIL_QUEUE_POLL_MS || 1500);
const MAX_ATTEMPTS = Number(process.env.MAIL_QUEUE_MAX_ATTEMPTS || 10);
const BASE_DELAY_MS = Number(process.env.MAIL_QUEUE_BASE_DELAY_MS || 2000);

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
function nextDelay(attempt){
  const d = BASE_DELAY_MS * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(d, 5 * 60 * 1000);
}
function safeUnlink(p){ try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch {} }

async function processOne(jobFile){
  const job = loadJob(jobFile);
  if (!job) { try { moveJob(jobFile, FAIL_DIR); } catch {} return; }
  if (job.nextAttemptAt && Date.now() < job.nextAttemptAt) return;

  job.status = "sending";
  saveJob(jobFile, job);

  try {
    await sendMailWithLog(transporter, job.payload.mailOptions, job.payload.formType, job.payload.meta);
    (job.payload.cleanupPaths || []).forEach(safeUnlink);
    job.status = "sent";
    job.sentAt = new Date().toISOString();
    saveJob(jobFile, job);
    moveJob(jobFile, DONE_DIR);
  } catch (e) {
    job.attempts = (job.attempts || 0) + 1;
    job.lastError = String(e?.message || e);

    if (job.attempts >= MAX_ATTEMPTS) {
      job.failedAt = new Date().toISOString();
      saveJob(jobFile, job);
      moveJob(jobFile, FAIL_DIR);
    } else {
      job.nextAttemptAt = Date.now() + nextDelay(job.attempts);
      saveJob(jobFile, job);
    }
  }
}

(async function loop(){
  console.log("[INLINE_MAIL_WORKER] started");
  while(true){
    try {
      for (const jf of listReadyJobs()) await processOne(jf);
    } catch (e) {
      console.warn("[INLINE_MAIL_WORKER] loop error:", e?.message || e);
    }
    await sleep(POLL_MS);
  }
})();
