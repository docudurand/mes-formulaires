
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
  'Casti Jeremy':   'comvl2miribel@durandservices.fr',
  'Trenti Anthony': 'comvlchassieu@durandservices.fr',
  'Bazoge Ilona':   'comvl2chassieu@durandservices.fr',
  'Pichard Damien': 'magvl4gleize@durandservices.fr'
};

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  }
});

router.post('/send-order', async (req, res) => {
  const { client, salesperson, pdf } = req.body;
  if (!pdf) {
    return res.status(400).json({ success: false, error: 'no_pdf' });
  }

  const to = salesMap[salesperson] || process.env.DEFAULT_TO;
  if (!to) {
    return res.status(400).json({ success: false, error: 'no_recipient' });
  }

  const mailOptions = {
    from: `"Bon de Commande" <${process.env.GMAIL_USER}>`,
    to,
    subject: `BDC - ${salesperson} – ${client || 'Client inconnu'}`,
    text: 'Veuillez trouver le bon de commande en pièce jointe (PDF).',
    attachments: [{
      filename: `Bon ${salesperson} – ${client || 'Client inconnu'}.pdf`,
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
