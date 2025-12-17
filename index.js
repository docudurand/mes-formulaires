import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
// Import the shared mailer configuration. This centralizes SMTP/Gmail
// credentials and exposes a single transporter and default sender.
import { transporter, fromEmail } from './mailer.js';

dotenv.config();

const router = express.Router();

router.use(cors());
router.use(express.json({ limit: '15mb' }));

router.get('/healthz', (_req, res) => {
  res.sendStatus(200);
});

// Build a mapping between salesperson codes and destination email
// addresses. The SALES_MAP_JSON environment variable should be a JSON
// object mapping salesperson identifiers to one or more email
// addresses. If parsing fails, an empty object is used.
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

router.post('/send-order', async (req, res) => {
  const { client, salesperson, pdf, form_origin } = req.body;

  if (!pdf) {
    return res.status(400).json({ success: false, error: 'no_pdf' });
  }

  // Determine the destination email address. We first look up the
  // salesperson in the JSON mapping; failing that we fall back to
  // DEFAULT_TO or the legacy MAIL_TO variable.
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

  // If no transporter is configured (for example if credentials are missing),
  // return an error immediately to avoid hanging the request.
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