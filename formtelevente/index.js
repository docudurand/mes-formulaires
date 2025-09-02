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

const salesMap = {
  'Casti Jeremy':   'comvl2miribel@durandservices.fr,magvl4gleize@durandservices.fr',
  'Trenti Anthony': 'comvlchassieu@durandservices.fr,magvl4gleize@durandservices.fr',
  'Bazoge Ilona':   'comvl2chassieu@durandservices.fr,magvl4gleize@durandservices.fr',
  'Barret Olivier': 'magvl4gleize@durandservices.fr',
};

function getFromName(formOriginRaw) {
  const s = String(formOriginRaw || '').toLowerCase();
  if (s.includes('bosch')) return 'Bon de Commande BOSCH';
  if (s.includes('lub'))   return 'Bon de Commande LUB';
  return 'Bon de Commande';
}

function getSubjectPrefix(formOriginRaw) {
  const s = String(formOriginRaw || '').toLowerCase();
  if (s.includes('bosch')) return 'BDC - BOSCH';
  if (s.includes('lub'))   return 'BDC - LUB';
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

  const to = salesMap[salesperson] || process.env.DEFAULT_TO;
  if (!to) {
    return res.status(400).json({ success: false, error: 'no_recipient' });
  }

  const today = new Date();
  const dateStr = `${today.getFullYear()}-${(today.getMonth()+1).toString().padStart(2,'0')}-${today.getDate().toString().padStart(2,'0')}`;

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