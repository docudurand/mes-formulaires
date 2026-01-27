// routes televente (envoi de bon de commande par email)

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { transporter, fromEmail } from '../mailer.js';
import ftp from 'basic-ftp';
import crypto from 'crypto';

// Chargement des variables d'environnement pour ce module
dotenv.config();

// routeur Express separe pour la televente
const router = express.Router();

router.use(cors());
router.use(express.json({ limit: '15mb' }));

router.get('/healthz', (_req, res) => {
  res.sendStatus(200);
});

// Map vendeur -> email (lu depuis env JSON)
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

// Choisit le nom "from" selon l'origine du formulaire
function getFromName(formOriginRaw) {
  const s = String(formOriginRaw || '').toLowerCase();
  if (s.includes('bosch')) return 'Bon de Commande BOSCH Janvier 2026';
  if (s.includes('lub'))   return 'Bon de Commande LUB 2026';
  return 'Bon de Commande';
}

// Prefix sujet email selon l'origine du formulaire
function getSubjectPrefix(formOriginRaw) {
  const s = String(formOriginRaw || '').toLowerCase();
  if (s.includes('bosch')) return 'BOSCH JANVIER 2026';
  if (s.includes('lub'))   return 'LUB 2026';
  return 'BDC';
}

// Fichier local pour compter les PDFs (si pas de FTP)
const COUNTERS_FILE_LOCAL = path.join(os.tmpdir(), 'televente_pdf_counters.json');

// Parametres FTP
const FTP_ROOT_BASE = (process.env.FTP_BACKUP_FOLDER || '/').replace(/\/$/, '');
const COUNTERS_REMOTE_DIR = (process.env.TELEVENTE_COUNTERS_DIR || `${FTP_ROOT_BASE}/televente`).replace(/\/$/, '');
const COUNTERS_REMOTE_FILE = `${COUNTERS_REMOTE_DIR}/pdf_counters.json`;

// si FTP pas configure, on reste en local
const FTP_ENABLED = Boolean(process.env.FTP_HOST && process.env.FTP_USER && process.env.FTP_PASSWORD);

// Lecture du compteur local
function readLocalCountersSafe() {
  try {
    if (!fs.existsSync(COUNTERS_FILE_LOCAL)) return {};
    const raw = fs.readFileSync(COUNTERS_FILE_LOCAL, 'utf-8');
    const obj = JSON.parse(raw);
    return (obj && typeof obj === 'object') ? obj : {};
  } catch {
    return {};
  }
}

// Ecriture du compteur local
function writeLocalCountersSafe(counters) {
  try {
    fs.writeFileSync(COUNTERS_FILE_LOCAL, JSON.stringify(counters, null, 2), 'utf-8');
  } catch (e) {
    console.warn('[televente] cannot persist local counters:', e?.message || e);
  }
}

// Helper FTP
async function withFtpClient(fn) {
  const client = new ftp.Client(30000);
  try {
    await client.access({
      host: process.env.FTP_HOST,
      user: process.env.FTP_USER,
      password: process.env.FTP_PASSWORD,
      port: process.env.FTP_PORT ? Number(process.env.FTP_PORT) : 21,
      secure: String(process.env.FTP_SECURE || 'false') === 'true',
      secureOptions: {
        rejectUnauthorized: String(process.env.FTP_TLS_REJECT_UNAUTH || '1') === '1',
        servername: process.env.FTP_HOST || undefined,
      },
    });
    return await fn(client);
  } finally {
    client.close();
  }
}

// Lecture du compteur distant via FTP
async function readRemoteCountersSafe() {
  const tmp = path.join(os.tmpdir(), `televente_counters_${crypto.randomUUID()}.json`);
  try {
    return await withFtpClient(async (client) => {
      try {
        await client.downloadTo(tmp, COUNTERS_REMOTE_FILE);
      } catch {
        return {};
      }
      try {
        const raw = fs.readFileSync(tmp, 'utf-8');
        const obj = JSON.parse(raw);
        return (obj && typeof obj === 'object') ? obj : {};
      } catch {
        return {};
      }
    });
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

// Ecriture du compteur distant via FTP
async function writeRemoteCountersSafe(counters) {
  const tmp = path.join(os.tmpdir(), `televente_counters_${crypto.randomUUID()}.json`);
  const remoteTmp = `${COUNTERS_REMOTE_DIR}/pdf_counters_${Date.now()}_${Math.random().toString(16).slice(2)}.json`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(counters, null, 2), 'utf-8');

    await withFtpClient(async (client) => {
      try { await client.ensureDir(COUNTERS_REMOTE_DIR); } catch {}
      await client.uploadFrom(tmp, remoteTmp);
      try { await client.remove(COUNTERS_REMOTE_FILE); } catch {}
      await client.rename(remoteTmp, COUNTERS_REMOTE_FILE);
    });
  } catch (e) {
    console.warn('[televente] cannot persist remote counters:', e?.message || e);
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

// lock simple pour eviter les collisions d'increment
let _counterLock = Promise.resolve();

// Prochain numero pour un couple (vendeur/client/date)
function nextCounter(baseKey) {
  _counterLock = _counterLock.then(async () => {
    const counters = FTP_ENABLED ? await readRemoteCountersSafe() : readLocalCountersSafe();
    const n = (Number(counters[baseKey]) || 0) + 1;
    counters[baseKey] = n;

    if (FTP_ENABLED) await writeRemoteCountersSafe(counters);
    else writeLocalCountersSafe(counters);

    return n;
  });

  return _counterLock;
}

// Envoi du PDF par email (televente)
router.post('/send-order', async (req, res) => {
  const { client, salesperson, pdf, form_origin } = req.body;

  if (!pdf) {
    return res.status(400).json({ success: false, error: 'no_pdf' });
  }

  if (!transporter) {
    console.error('[televente] SMTP not configured');
    return res.status(500).json({ success: false, error: 'smtp_not_configured' });
  }

  // Choix du destinataire (vendeur, default, ou MAIL_TO)
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

  // Donnees pour le nom de fichier
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

  const baseKey = `${safeSales}__${safeClient}__${dateStr}`;
  const n = await nextCounter(baseKey);
  const pdfFilename = `Bon ${safeSales} – ${safeClient} ${dateStr} N°${n}.pdf`;

  // Email final (avec PDF en piece jointe)
  const mailOptions = {
    from: `"${fromName}" <${fromEmail}>`,
    to,
    subject: `${subjectPrefix} ${salesperson || ''} – ${client || 'Client inconnu'}`,
    text: 'Veuillez trouver le bon de commande en pièce jointe (PDF).',
    attachments: [
      {
        filename: pdfFilename,
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
