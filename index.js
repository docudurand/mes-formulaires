// routes legacy (liens JSON + envoi televente)

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// Chargement des variables d'environnement
dotenv.config();

import { transporter, fromEmail } from './mailer.js';

// routeur Express separe
const router = express.Router();

router.use(cors());
router.use(express.json({ limit: '15mb' }));

function parseEnvJSON(raw, fallback) {
  let s = String(raw ?? "").trim();
  if (!s) return fallback;

  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
    s = s.slice(1, -1);
  }
  return JSON.parse(s);
}

// API: liens garantie/retour PL
router.get("/api/pl/liens-garantie-retour", (_req, res) => {
  try {
    const data = parseEnvJSON(process.env.PL_LIENS_GARANTIE_RETOUR_JSON, []);
    res.setHeader("Cache-Control", "no-store");
    return res.json(data);
  } catch {
    return res.status(500).json({ error: "PL_LIENS_GARANTIE_RETOUR_JSON invalide" });
  }
});

// API: liens formulaire garantie VL
router.get("/api/vl/liens-formulaire-garantie", (_req, res) => {
  try {
    const data = parseEnvJSON(process.env.VL_LIENS_FORMULAIRE_GARANTIE_JSON, []);
    res.setHeader("Cache-Control", "no-store");
    return res.json(data);
  } catch {
    return res.status(500).json({ error: "VL_LIENS_FORMULAIRE_GARANTIE_JSON invalide" });
  }
});


// API: retour garantie VL
router.get("/api/vl/retour-garantie", (_req, res) => {
  try {
    const data = parseEnvJSON(process.env.VL_RETOUR_GARANTIE_JSON, {});
    res.setHeader("Cache-Control", "no-store");
    return res.json(data);
  } catch {
    return res.status(500).json({ error: "VL_RETOUR_GARANTIE_JSON invalide" });
  }
});

router.get('/healthz', (_req, res) => {
  res.sendStatus(200);
});

// Map vendeur -> email (televente)
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

// Choisit le nom "from" selon origine
function getFromName(formOriginRaw) {
  const s = String(formOriginRaw || '').toLowerCase();
  if (s.includes('bosch')) return 'Bon de Commande BOSCH Janvier 2026';
  if (s.includes('lub'))   return 'Bon de Commande LUB 2026';
  return 'Bon de Commande';
}

// Prefix sujet email selon origine
function getSubjectPrefix(formOriginRaw) {
  const s = String(formOriginRaw || '').toLowerCase();
  if (s.includes('bosch')) return 'BOSCH JANVIER 2026';
  if (s.includes('lub'))   return 'LUB 2026';
  return 'BDC';
}

// Envoi d'un bon de commande par email
router.post('/send-order', async (req, res) => {
  const { client, salesperson, pdf, form_origin } = req.body;

  if (!pdf) {
    return res.status(400).json({ success: false, error: 'no_pdf' });
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
  const dateStr = `${today.getFullYear()}-${(today.getMonth()+1).toString().padStart(2,'0')}`;

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

  // sans SMTP, pas d'envoi
  if (!transporter) {
    console.error('Email transporter not configured');
    return res.status(500).json({ success: false, error: 'smtp_not_configured' });
  }

  const mailOptions = {
    from: `"${fromName}" <${fromEmail}>`,
    to,
    subject: `${subjectPrefix} ${salesperson || ''} – ${client || 'Client inconnu'}`,
    text: 'Veuillez trouver le bon de commande en pièce jointe (PDF).',
    attachments: [{
      filename: `Bon ${safeSales} – ${safeClient} ${dateStr}.pdf`,
      content: Buffer.from(pdf, 'base64'),
      contentType: 'application/pdf'
    }]
  };

  try {
    await transporter.sendMail(mailOptions);
    return res.json({ success: true });
  } catch (error) {
    console.error('Email send failed:', error);
    return res.status(500).json({ success: false, error: 'email_failed' });
  }
});

export default router;
