import express from 'express';
import multer from 'multer';
import nodemailer from 'nodemailer';
import cors from 'cors';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();

router.use(cors());
router.use(express.urlencoded({ extended: true }));
router.use(express.json({ limit: '15mb' }));

router.get('/healthz', (_req, res) => res.sendStatus(200));
router.get('/', (_req, res) => res.send('🛞 Formulaire Création Pneumatique VL – OK'));

const FIELD_LABELS = {
  email:      "Adresse e-mail",
  fournisseur:"Fournisseur de Réappro",
  ean:        "EAN",
  cai:        "CAI",
  adherence:  "Adhérence sol mouillé",
  conso:      "Consommation carburant",
  sonore:     "Niveau sonore",
  classe:     "Classe de performance",
  designation:"Désignation Pneu",
  prixBF:     "Prix BF",
  prixAchat:  "Prix d'achat"
};

const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const forbidden = /\.(exe|bat|sh|cmd|js)$/i;
    if (forbidden.test(file.originalname)) {
      return cb(new Error('Type de fichier non autorisé.'), false);
    }
    cb(null, true);
  }
});

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  }
});

function generateHtml(data) {
  const rows = Object.entries(FIELD_LABELS).map(([key, label]) => `
    <tr>
      <td style="padding:8px; border:1px solid #ccc; background:#f8f8f8; font-weight:bold;">
        ${label}
      </td>
      <td style="padding:8px; border:1px solid #ccc;">
        ${data[key] || '<em>(non renseigné)</em>'}
      </td>
    </tr>
  `).join('');

  return `
    <div style="font-family:Arial,sans-serif; max-width:700px; margin:auto;">
      <h2 style="color:#007bff; text-align:center;">🛞 Formulaire Création Pneumatique VL</h2>
      <table style="width:100%; border-collapse:collapse; margin-top:20px;">
        ${rows}
      </table>
      <p style="margin-top:20px;">📎 Fichiers joints inclus si fournis.</p>
    </div>
  `;
}

router.post(
  '/submit-form',
  upload.array('fichiers[]'),
  async (req, res) => {
    const formData = req.body;
    const attachments = (req.files || []).map(file => ({
      filename: file.originalname,
      path: file.path
    }));

    const mailOptions = {
      from: `"Formulaire création VL" <${process.env.GMAIL_USER}>`,
      to: process.env.DEST_EMAIL_FORMULAIRE_PNEU,
      subject: '📨 Demande création référence Pneumatique VL',
      replyTo: formData.email,
      html: generateHtml(formData),
      attachments
    };

    try {
      await transporter.sendMail(mailOptions);
      res.status(200).send('Formulaire envoyé !');
    } catch (err) {
      console.error('Envoi mail échoué :', err);
      res.status(500).send("Erreur lors de l'envoi.");
    } finally {
      (req.files || []).forEach(file => {
        fs.unlink(file.path, () => {});
      });
    }
  }
);

export default router;
