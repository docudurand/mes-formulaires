import express from "express";
import multer from "multer";
import cors from "cors";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import crypto from "crypto";
import { fromEmail } from "../mailer.js";
import { enqueueMailJob, getIdempotencyKey } from "../mailQueue.js";

dotenv.config();

const router = express.Router();

router.use(cors());
router.use(express.urlencoded({ extended: true }));
router.use(express.json({ limit: "15mb" }));

router.get("/healthz", (_req, res) => res.sendStatus(200));
router.get("/", (_req, res) => res.send("🧩 Formulaire Création Référence Pièce VL – OK"));

const FIELD_LABELS = {
  email: "Adresse e-mail",
  magasin: "Magasin",
  fournisseur: "Fournisseur",
  marque: "Marque",
  reference: "Référence",
  designation: "Désignation",
  puAchat: "PU Achat",
  commentaire: "Commentaire",
};

const UPLOAD_DIR = (process.env.UPLOAD_DIR || path.resolve(process.cwd(), "uploads")).trim();
try {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
} catch {}

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const forbidden = /\.(exe|bat|sh|cmd|js)$/i;
    if (forbidden.test(file.originalname)) {
      return cb(new Error("Type de fichier non autorisé."), false);
    }
    cb(null, true);
  },
});

function generateHtml(data) {
  const rows = Object.entries(FIELD_LABELS)
    .map(
      ([key, label]) => `
    <tr>
      <td style="padding:8px; border:1px solid #ccc; background:#f8f8f8; font-weight:bold;">
        ${label}
      </td>
      <td style="padding:8px; border:1px solid #ccc;">
        ${data[key] || "<em>(non renseigné)</em>"}
      </td>
    </tr>
  `
    )
    .join("");

  return `
    <div style="font-family:Arial,sans-serif; max-width:700px; margin:auto;">
      <h2 style="color:#007bff; text-align:center;">🧩 Demande de création référence Pièce VL</h2>
      <table style="width:100%; border-collapse:collapse; margin-top:20px;">
        ${rows}
      </table>
      <p style="margin-top:20px;">📎 Fichiers joints inclus si fournis.</p>
    </div>
  `;
}

router.post("/submit-form", upload.array("fichiers[]"), async (req, res) => {
  const formData = req.body;

  const files = Array.isArray(req.files) ? req.files : [];
  const attachments = files.map((file) => ({
    filename: file.originalname,
    path: file.path,
  }));

  try {
    if (!process.env.DEST_EMAIL_FORMULAIRE_PIECE) {
      console.error("[formulaire-piece] DEST_EMAIL_FORMULAIRE_PIECE missing");
      return res.status(500).send("Erreur: destinataire non configuré.");
    }

    const requestId =
      getIdempotencyKey(req) ||
      (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex"));

    const mailOptions = {
      from: `"Formulaire création Pièce VL" <${fromEmail}>`,
      to: process.env.DEST_EMAIL_FORMULAIRE_PIECE,
      subject: "📨 Demande de création référence Pièce VL",
      replyTo: formData.email,
      html: generateHtml(formData),
      attachments,
    };

    enqueueMailJob({
      idempotencyKey: `${requestId}:piece-vl:magasin`,
      mailOptions,
      formType: "creation-piece-vl",
      meta: {
        kind: "magasin",
        demandeur: formData.email || "",
        magasin: (formData.magasin || "").slice(0, 80),
        marque: (formData.marque || "").slice(0, 80),
        reference: (formData.reference || "").slice(0, 80),
        designation: (formData.designation || "").slice(0, 120),
      },
      cleanupPaths: files.map((f) => f.path),
    });

    if (formData.email) {
      const accuserecepOptions = {
        from: `"Service Pièces VL" <${fromEmail}>`,
        to: formData.email,
        subject: "Votre demande de création de référence pièce a bien été reçue",
        html: `
          <div style="font-family:Arial,sans-serif; max-width:700px; margin:auto;">
            <h2 style="text-align:center; color:#28a745;">✔️ Accusé de réception</h2>
            <p>Bonjour,</p>
            <p>Nous avons bien reçu votre demande de création de référence pièce (VL).</p>
            <p>Nous la traiterons dans les plus brefs délais.</p>
            <p><b>Résumé :</b></p>
            <table style="width:100%; border-collapse:collapse; margin-top:10px;">
              ${Object.entries(FIELD_LABELS)
                .map(
                  ([key, label]) => `
                <tr>
                  <td style="padding:6px; border:1px solid #eee; background:#f8f8f8; font-weight:bold;">${label}</td>
                  <td style="padding:6px; border:1px solid #eee;">${formData[key] || "<em>(non renseigné)</em>"}</td>
                </tr>
              `
                )
                .join("")}
            </table>
            <p style="margin-top:20px;">Ceci est un accusé automatique, merci de ne pas répondre.</p>
            <p>L’équipe Pièces VL</p>
          </div>
        `,
        attachments: [],
      };

      enqueueMailJob({
        idempotencyKey: `${requestId}:piece-vl:ack`,
        mailOptions: accuserecepOptions,
        formType: "creation-piece-vl",
        meta: { kind: "demandeur", demandeur: formData.email || "" },
        cleanupPaths: [],
      });
    }

    return res.status(202).send("Formulaire enregistré. Envoi en cours…");
  } catch (err) {
    console.error("[formulaire-piece] Queue failed:", err);
    return res.status(500).send("Erreur lors de l'enregistrement.");
  }
});

export default router;