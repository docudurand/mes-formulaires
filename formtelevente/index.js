import express from 'express';
import cors from 'cors';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

// Charge les variables d'environnement depuis le fichier .env (si présent)
dotenv.config();

const router = express.Router();

// Middleware CORS et JSON
router.use(cors());
router.use(express.json({ limit: '15mb' }));

// Route de santé simple
router.get('/healthz', (_req, res) => {
  res.sendStatus(200);
});

// Dictionnaire des destinataires par commercial chargé depuis l'environnement
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

// Transporteur SMTP configuré avec Gmail ; le mot de passe peut contenir des guillemets
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    // Nettoie les guillemets/espaces éventuels dans le mot de passe
    pass: String(process.env.GMAIL_PASS || '').replace(/["\s]/g, '')
  }
});

// Envoi du bon de commande ; le PDF doit être fourni en base64
router.post('/send-order', async (req, res) => {
  const { client, salesperson, pdf, form_origin } = req.body;

  // Aucun PDF fourni → erreur 400
  if (!pdf) {
    return res.status(400).json({ success: false, error: 'no_pdf' });
  }

  // Détermine les destinataires à partir du commercial ou de la variable d'environnement par défaut
  const to = salesMap[salesperson] || process.env.DEFAULT_TO;
  if (!to) {
    return res.status(400).json({ success: false, error: 'no_recipient' });
  }

  // Prépare les champs texte de manière sûre (pas de caractères spéciaux)
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