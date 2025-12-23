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

    const files = req.files || [];
    const attachments = files.map(file => ({
      filename: file.originalname,
      path: file.path
    }));

    try {
      if (!transporter) {
        console.error('[formulaire-pneu] SMTP not configured');
        return res.status(500).send("Erreur d'envoi: SMTP non configuré.");
      }

      if (!process.env.DEST_EMAIL_FORMULAIRE_PNEU) {
        console.error('[formulaire-pneu] DEST_EMAIL_FORMULAIRE_PNEU missing');
        return res.status(500).send("Erreur d'envoi: destinataire non configuré.");
      }
      const mailOptions = {
        from: `"Formulaire création Pneu VL" <${fromEmail}>`,
        to: process.env.DEST_EMAIL_FORMULAIRE_PNEU,
        subject: '📨 Demande de création référence Pneumatique VL',
        replyTo: formData.email,
        html: generateHtml(formData),
        attachments
      };

      await transporter.sendMail(mailOptions);

      if (formData.email) {
        const accuserecepOptions = {
          from: `"Service Pneumatiques VL" <${fromEmail}>`,
          to: formData.email,
          subject: "Votre demande de création de référence pneu a bien été reçue",
          html: `
            <div style="font-family:Arial,sans-serif; max-width:700px; margin:auto;">
              <h2 style="text-align:center; color:#28a745;">✔️ Accusé de réception</h2>
              <p>Bonjour,</p>
              <p>Nous avons bien reçu votre demande de création de référence pneumatique VL.</p>
              <p>Nous la traiterons dans les plus brefs délais.<br>
              <b>Résumé de votre demande :</b></p>
              <table style="width:100%; border-collapse:collapse; margin-top:10px;">
                ${Object.entries(FIELD_LABELS).map(([key, label]) => `
                  <tr>
                    <td style="padding:6px; border:1px solid #eee; background:#f8f8f8; font-weight:bold;">${label}</td>
                    <td style="padding:6px; border:1px solid #eee;">${formData[key] || '<em>(non renseigné)</em>'}</td>
                  </tr>
                `).join('')}
              </table>
              <p style="margin-top:20px;">Ceci est un accusé automatique, merci de ne pas répondre.</p>
              <p>L’équipe Pneumatiques VL</p>
            </div>
          `,
          attachments
        };

        try {
          await transporter.sendMail(accuserecepOptions);
        } catch (err) {
          console.error('[formulaire-pneu] Erreur envoi accusé réception :', err);
        }
      }

      res.status(200).send('Formulaire envoyé !');
    } catch (err) {
      console.error('[formulaire-pneu] Envoi mail échoué :', err);
      res.status(500).send("Erreur lors de l'envoi.");
    } finally {
      files.forEach(file => {
        fs.unlink(file.path, () => {});
      });
    }
  }
);

export default router;
