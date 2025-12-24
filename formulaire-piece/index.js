import express from "express";
import multer from "multer";
import cors from "cors";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { transporter, fromEmail } from "../mailer.js";
import { sendMailWithLog } from "../mailLog.js";

dotenv.config();

const router = express.Router();

router.use(cors());
router.use(express.urlencoded({ extended: true }));
router.use(express.json({ limit: "15mb" }));

router.get("/healthz", (_req, res) => res.sendStatus(200));
router.get("/", (_req, res) => res.send("✅ Formulaire Création Référence VL – OK"));

const FORM_FIELDS = {
  email: "Adresse e-mail",
  marque: "Marque",
  fournisseur: "Fournisseur de Réappro",
  reference: "Référence",
  designation: "Désignation pièce (Si en Anglais)",
  tarif: "Tarif",
  remise: "Remise",
};

const UPLOAD_DIR = process.env.UPLOAD_DIR || "uploads";
if (!fs.existsSync(UPLOAD_DIR)) {
  try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch {}
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || "") || ".bin";
      const base = path
        .basename(file.originalname || "file", ext)
        .replace(/[^a-z0-9-_]+/gi, "_")
        .slice(0, 80);
      cb(null, `${Date.now()}_${base}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const forbidden = /\.(exe|bat|sh|cmd|js)$/i;
    if (forbidden.test(file.originalname || "")) {
      return cb(new Error("Type de fichier non autorisé."), false);
    }
    cb(null, true);
  },
});

function generateHtml(data) {
  const rows = Object.entries(FORM_FIELDS)
    .map(
      ([key, label]) => `
    <tr>
      <td style="padding:8px; border:1px solid #ccc; background:#f8f8f8; font-weight:bold;">
        ${label}
      </td>
      <td style="padding:8px; border:1px solid #ccc;">
        ${data?.[key] ? String(data[key]) : "<em>(non renseigné)</em>"}
      </td>
    </tr>
  `
    )
    .join("");

  return `
    <div style="font-family:Arial; max-width:700px; margin:auto;">
      <h2 style="text-align:center; color:#007bff;">🔧 Formulaire Création Référence VL</h2>
      <table style="width:100%; border-collapse:collapse; margin-top:20px;">
        ${rows}
      </table>
      <p style="margin-top:20px;">📎 Des fichiers sont joints à ce message si fournis.</p>
    </div>
  `;
}

router.post("/submit-form", upload.array("fichiers[]"), async (req, res) => {
  const formData = req.body || {};

  const files = Array.isArray(req.files) ? req.files : [];
  const attachments = files.map((file) => ({
    filename: file.originalname,
    path: file.path,
  }));

  try {
    if (!transporter) {
      console.error("[creation-vl] SMTP not configured");
      return res.status(500).send("Erreur d'envoi: SMTP non configuré.");
    }

    const to =
      process.env.DEST_EMAIL_FORMULAIRE_CREATION_VL ||
      process.env.DEST_EMAIL_FORMULAIRE_PIECE ||
      "";

    if (!to) {
      console.error("[creation-vl] DEST_EMAIL_FORMULAIRE_CREATION_VL / DEST_EMAIL_FORMULAIRE_PIECE missing");
      return res.status(500).send("Erreur d'envoi: destinataire non configuré.");
    }

    const mailOptions = {
      from: `"Formulaire création VL" <${fromEmail}>`,
      to,
      subject: "📨 Demande de création référence VL",
      replyTo: formData.email,
      html: generateHtml(formData),
      attachments,
    };

    await sendMailWithLog(transporter, mailOptions, "creation-reference-vl", {
      kind: "magasin",
      demandeur: formData.email || "",
      marque: (formData.marque || "").slice(0, 80),
      reference: (formData.reference || "").slice(0, 80),
    });

    if (formData.email) {
      const accuserecepOptions = {
        from: `"Service Pièces VL" <${fromEmail}>`,
        to: formData.email,
        subject: "Votre demande de création de référence a bien été reçue",
        html: `
          <div style="font-family:Arial; max-width:700px; margin:auto;">
            <h2 style="text-align:center; color:#28a745;">✔️ Accusé de réception</h2>
            <p>Bonjour,</p>
            <p>Nous avons bien reçu votre demande de création de référence.</p>
            <p>Nous la traiterons dans les plus brefs délais.<br><b>Résumé de votre demande :</b></p>
            <table style="width:100%; border-collapse:collapse; margin-top:10px;">
              ${Object.entries(FORM_FIELDS)
                .map(
                  ([key, label]) => `
                <tr>
                  <td style="padding:6px; border:1px solid #eee; background:#f8f8f8; font-weight:bold;">${label}</td>
                  <td style="padding:6px; border:1px solid #eee;">${
                    formData?.[key] ? String(formData[key]) : "<em>(non renseigné)</em>"
                  }</td>
                </tr>
              `
                )
                .join("")}
            </table>
            <p style="margin-top:20px;">Ceci est un accusé automatique, merci de ne pas répondre.</p>
          </div>
        `,

        attachments,
      };

      await sendMailWithLog(transporter, accuserecepOptions, "creation-reference-vl", {
        kind: "demandeur",
        demandeur: formData.email || "",
      });
    }

    res.status(200).send("Formulaire envoyé !");
  } catch (err) {
    console.error("[creation-vl] Envoi mail échoué :", err);
    res.status(500).send("Erreur lors de l'envoi.");
  } finally {
    for (const file of files) {
      fs.unlink(file.path, () => {});
    }
  }
});

export default router;
