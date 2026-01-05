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
router.get("/", (_req, res) => res.send("🛞 Formulaire Création Pneumatique VL – OK"));

const FIELD_LABELS = {
  email: "Adresse e-mail",
  fournisseur: "Fournisseur de Réappro",
  ean: "EAN",
  cai: "CAI",
  adherence: "Adhérence sol mouillé",
  conso: "Consommation carburant",
  sonore: "Niveau sonore",
  classe: "Classe de performance",
  designation: "Désignation Pneu",
  prixBF: "Prix BF",
  prixAchat: "Prix d'achat",
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
      <h2 style="color:#007bff; text-align:center;">🛞 Formulaire Création Pneumatique VL</h2>
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
    if (!process.env.DEST_EMAIL_FORMULAIRE_PNEU) {
      console.error("[formulaire-pneu] DEST_EMAIL_FORMULAIRE_PNEU missing");
      return res.status(500).send("Erreur: destinataire non configuré.");
    }

    const requestId =
      getIdempotencyKey(req) ||
      (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex"));

    const mailOptions = {
      from: `"Formulaire création Pneu VL" <${fromEmail}>`,
      to: process.env.DEST_EMAIL_FORMULAIRE_PNEU,
      subject: "📨 Demande de création référence Pneumatique VL",
      replyTo: formData.email,
      html: generateHtml(formData),
      attachments,
    };

    enqueueMailJob({
      idempotencyKey: `${requestId}:pneu:magasin`,
      mailOptions,
      formType: "creation-pneu-vl",
      meta: {
        kind: "magasin",
        demandeur: formData.email || "",
        fournisseur: (formData.fournisseur || "").slice(0, 80),
        ean: (formData.ean || "").slice(0, 40),
        designation: (formData.designation || "").slice(0, 120),
      },
      cleanupPaths: files.map((f) => f.path),
    });

    // JOB 2: accusé réception (sans PJ)
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
            <p>L’équipe Pneumatiques VL</p>
          </div>
        `,
        attachments: [],
      };

      enqueueMailJob({
        idempotencyKey: `${requestId}:pneu:ack`,
        mailOptions: accuserecepOptions,
        formType: "creation-pneu-vl",
        meta: { kind: "demandeur", demandeur: formData.email || "" },
        cleanupPaths: [],
      });
    }

    return res.status(202).send("Formulaire enregistré. Envoi en cours…");
  } catch (err) {
    console.error("[formulaire-pneu] Queue failed:", err);
    return res.status(500).send("Erreur lors de l'enregistrement.");
  }
});

export default router;