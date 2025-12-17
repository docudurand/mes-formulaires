import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  SMTP_SECURE,
  FROM_EMAIL,
  FROM_NAME,
} = process.env;

function isTruthy(v) {
  if (!v) return false;
  const s = String(v).trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

let transporter = undefined;
let fromEmail = (FROM_EMAIL || "").trim();
let fromName = (FROM_NAME || "").trim();

if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
  const port = SMTP_PORT ? Number(SMTP_PORT) : 587;
  const secure = isTruthy(SMTP_SECURE) || port === 465;

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  if (!fromEmail) fromEmail = SMTP_USER;
} else {
  transporter = undefined;
}

console.log("[MAILER] provider=SMTP");
console.log("[MAILER] SMTP_HOST =", SMTP_HOST || "(missing)");
console.log("[MAILER] SMTP_PORT =", SMTP_PORT || "(default 587)");
console.log("[MAILER] FROM_EMAIL =", fromEmail || "(missing)");

export { transporter, fromEmail, fromName };
