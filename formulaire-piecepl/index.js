import express from 'express';
import multer from 'multer';
import cors from 'cors';
import fs from 'fs';
import dotenv from 'dotenv';
import { transporter, fromEmail } from '../mailer.js';

dotenv.config();

const router = express.Router();

router.use(cors());
router.use(express.urlencoded({ extended: true }));
router.use(express.json({ limit: '15mb' }));

router.get('/healthz', (_req, res) => res.sendStatus(200));
router.get('/', (_req, res) => res.send('✅ Formulaire Création Référence PL – OK'));

const FORM_FIELDS = {
  email:       "Adresse e-mail",
  marque:      "Marque",
  fournisseur: "Fournisseur de Réappro",
  reference:   "Référence",
  designation: "Désignation pièce (Si en Anglais)",
  tarif:       "Tarif",
  remise:      "Remise"
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

function generateHtml(data) {
  const rows = Object.entries(FORM_FIELDS).map(([key, label]) => `
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
    <div style="font-family:Arial; max-width:700px; margin:auto;">
      <h2 style="text-align:center; color:#007bff;">
        🚚 Formulaire Création Référence PL
      </h2>
      <table style="width:100%; border-collapse:collapse; margin-top:20px;">
        ${rows}
      </table>
      <p style="margin-top:20px;">
        📎 Des fichiers sont joints à ce message si fournis.
      </p>
    </div>
  `;
}

router.post(
  '/submit-form',
  upload.array('fichiers[]'),
  async (req, res) => {
    const formData = req.body;
    const attachments = req.files.map(file => ({
      filename: file.originalname,
      path: file.path
    }));

    if (!transporter) {
      console.error('[formulaire-piecepl] SMTP not configured');
      for (const file of req.files) {
        fs.unlink(file.path, () => {});
      }
      return res.status(500).send("Erreur d'envoi: SMTP non configuré.");
    }
    const mailOptions = {
      from: `"Formulaire création PL" <${fromEmail}>`,
      to: process.env.DEST_EMAIL_FORMULAIRE_PIECEPL,
      subject: '📨 Demande de création référence PL',
      replyTo: formData.email,
      html: generateHtml(formData),
      attachments
    };

    try {
      await transporter.sendMail(mailOptions);

      if (formData.email) {
        const accuserecepOptions = {
          from: `"Service Pièces PL" <${fromEmail}>`,
          to: formData.email,
          subject: "Votre demande de création de référence PL a bien été reçue",
          html: `
            <div style="font-family:Arial; max-width:700px; margin:auto;">
              <h2 style="text-align:center; color:#28a745;">✔️ Accusé de réception</h2>
              <p>Bonjour,</p>
              <p>Nous avons bien reçu votre demande de création de référence PL.</p>
              <p>Nous la traiterons dans les plus brefs délais.<br>
              <b>Résumé de votre demande :</b></p>
              <table style="width:100%; border-collapse:collapse; margin-top:10px;">
                ${Object.entries(FORM_FIELDS).map(([key, label]) => `
                  <tr>
                    <td style="padding:6px; border:1px solid #eee; background:#f8f8f8; font-weight:bold;">${label}</td>
                    <td style="padding:6px; border:1px solid #eee;">${formData[key] || '<em>(non renseigné)</em>'}</td>
                  </tr>
                `).join('')}
              </table>
              <p style="margin-top:20px;">Ceci est un accusé automatique, merci de ne pas répondre.</p>
            </div>
          `,
          attachments
        };

        try {
          await transporter.sendMail(accuserecepOptions);
        } catch (err) {
          console.error('[formulaire-piecepl] Erreur envoi accusé réception :', err);
        }
      }

      res.status(200).send('Formulaire envoyé !');
    } catch (err) {
      console.error('[formulaire-piecepl] Envoi mail échoué :', err);
      res.status(500).send("Erreur lors de l'envoi.");
    } finally {
      for (const file of req.files) {
        fs.unlink(file.path, () => {});
      }
    }
  }
);

export default router;