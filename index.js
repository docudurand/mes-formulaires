import express from 'express';
import cors from 'cors';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

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

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  }
});

router.post('/send-order', async (req, res) => {
  const { client, salesperson, pdf, form_origin } = req.body;

  if (!pdf) {
    return res.status(400).json({ success: false, error: 'no_pdf' });
  }

  // Détermination du destinataire.
  // On tente d'abord via le mapping JSON (par commercial), puis via DEFAULT_TO, puis via MAIL_TO.
  let to = '';
  if (salesperson && salesMap[salesperson]) {
    to = salesMap[salesperson];
  } else if (process.env.DEFAULT_TO) {
    to = process.env.DEFAULT_TO;
  } else if (process.env.MAIL_TO) {
    // MAIL_TO est la variable historique pour les destinataires par défaut
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

  const mailOptions = {
    from: `"${fromName}" <${process.env.GMAIL_USER}>`,
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