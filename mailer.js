// Centralized mailer configuration for Mes Formulaires
//
// This module creates a single nodemailer transporter based on environment
// variables. If SMTP_* variables are provided, it will use those to
// configure a custom SMTP server. Otherwise it falls back to the Gmail
// service using the existing GMAIL_USER and GMAIL_PASS credentials. A
// default fromEmail is also exported, which can be overridden via
// FROM_EMAIL in the .env file. See README or .env.example for details.

import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

// Load environment variables from .env if present. This does nothing if
// dotenv has already been called elsewhere.
dotenv.config();

const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  SMTP_SECURE,
  GMAIL_USER,
  GMAIL_PASS,
  FROM_EMAIL,
} = process.env;

/**
 * Determine whether the provided value represents a truthy boolean.
 * Accepts "true", "1", "yes" (case-insensitive) as truthy.
 * @param {string | undefined} v
 */
function isTruthy(v) {
  if (!v) return false;
  const s = String(v).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

let transporter;
let fromEmail;

if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
  // Use custom SMTP configuration.
  const port = SMTP_PORT ? Number(SMTP_PORT) : 587;
  const secure = isTruthy(SMTP_SECURE) || port === 465;
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });
  // Default from email uses FROM_EMAIL if provided, otherwise the SMTP_USER.
  fromEmail = FROM_EMAIL || SMTP_USER;
} else {
  // Fallback to Gmail. Clean any quotes/spaces from the app password.
  const user = GMAIL_USER;
  const pass = String(GMAIL_PASS || '').replace(/["\s]/g, '');
  if (user && pass) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
    });
    fromEmail = FROM_EMAIL || user;
  } else {
    // If no credentials are provided, leave transporter undefined. Callers
    // should handle this by checking for falsy and returning an error.
    transporter = undefined;
    fromEmail = FROM_EMAIL || user || '';
  }
}

export { transporter, fromEmail };