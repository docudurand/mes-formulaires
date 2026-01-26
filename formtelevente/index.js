import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { transporter, fromEmail } from '../mailer.js';

dotenv.config();

const router = express.Router();

router.use(cors());
router.use(express.json({ limit: '15mb' }));

router.get('/healthz', (_req, res) => {
  res.sendStatus(200);
});

let salesMap = {};
try {
  const raw = process.env.SALES_MAP_JSON;
  if (raw) {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      salesMap = parsed;
    }
  }
} catch {
  salesMap = {};
}

function getFromName(formOriginRaw) {
  const s = String(formOriginRaw || '').toLowerCase();
  if (s.includes('bosch')) return 'Bon de Commande BOSCH Janvier 2026';
  if (s.includes('lub'))   return 'Bon de Commande LUB 2026';
  return 'Bon de Commande';
}

function getSubjectPrefix(formOriginRaw) {
  const s = String(formOriginRaw || '').toLowerCase();
  if (s.includes('bosch')) return 'BOSCH JANVIER 2026';
  if (s.includes('lub'))   return 'LUB 2026';
  return 'BDC';
}


// --- PDF filename counter (persisted in /tmp) ---
// Goal: avoid overwriting when Power Automate saves files with same name in Teams.
const COUNTERS_FILE = path.join(os.tmpdir(), 'televente_pdf_counters.json');

function readCountersSafe() {
  try {
    if (!fs.existsSync(COUNTERS_FILE)) return {};
    const raw = fs.readFileSync(COUNTERS_FILE, 'utf-8');
    const obj = JSON.parse(raw);
    return (obj && typeof obj === 'object') ? obj : {};
  } catch {
    return {};
  }
}

function writeCountersSafe(counters) {
  try {
    fs.writeFileSync(COUNTERS_FILE, JSON.stringify(counters, null, 2), 'utf-8');
  } catch (e) {
    console.warn('[televente] cannot persist counters:', e?.message || e);
  }
}

// Returns an integer 1..n for a given base key (client+sales+YYYY-MM)
function nextCounter(baseKey) {
  const counters = readCountersSafe();
  const n = (Number(counters[baseKey]) || 0) + 1;
  counters[baseKey] = n;
  writeCountersSafe(counters);
  return n;
}

router.post('/send-order', async (req, res) => {
  const { client, salesperson, pdf, form_origin } = req.body;

  if (!pdf) {
    return res.status(400).json({ success: false, error: 'no_pdf' });
  }

  if (!transporter) {
    console.error('[televente] SMTP not configured');
    return res.status(500).json({ success: false, error: 'smtp_not_configured' });
  }

  let to = '';
  if (salesperson && salesMap[salesperson]) {
    to = salesMap[salesperson];
  } else if (process.env.DEFAULT_TO) {
    to = process.env.DEFAULT_TO;
  } else if (process.env.MAIL_TO) {
    to = process.env.MAIL_TO;
  }

  if (!to) {
    return res.status(400).json({ success: false, error: 'no_recipient' });
  }

  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

  const safeClient = (client || 'Client inconnu')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const safeSales = (salesperson || '')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const fromName = getFromName(form_origin);
  const subjectPrefix = getSubjectPrefix(form_origin);

  const mailOptions = {
    from: `"${fromName}" <${fromEmail}>`,
    to,
    subject: `${subjectPrefix} ${salesperson || ''} – ${client || 'Client inconnu'}`,
    text: 'Veuillez trouver le bon de commande en pièce jointe (PDF).',
    attachments: [
      {
        filename: (() => {
        const baseKey = `${safeSales}__${safeClient}__${dateStr}`;
        const n = nextCounter(baseKey);
        return `Bon ${safeSales} – ${safeClient} ${dateStr} N°${n}.pdf`;
      })(),
        content: Buffer.from(pdf, 'base64'),
        contentType: 'application/pdf',
      },
    ],
  };

  try {
    await transporter.sendMail(mailOptions);
    return res.json({ success: true });
  } catch (error) {
    console.error('[televente] Email send failed:', error);
    return res.status(500).json({ success: false, error: 'email_failed' });
  }
});

export default router;