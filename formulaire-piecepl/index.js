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

const UPLOAD_DIR = process.env.UPLOAD_DIR || "/var/data/uploads";
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-() ]+/g, "_");
    cb(null, `${Date.now()}-${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
});

const FORM_FIELDS = {
  email: "Adresse e-mail",
  magasin: "Magasin",
  fournisseur: "Fournisseur",
  marque: "Marque",
  reference: "Référence",
  designation: "Désignation",
  puAchat: "PU Achat",
  commentaire: "Commentaire",
};

function escapeHtml(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function valueOrEmpty(data, key) {
  const v = data?.[key];
  return v !== undefined && v !== null && String(v).trim() !== ""
    ? escapeHtml(String(v))
    : "<em>(non renseigné)</em>";
}

function buildHtml(data = {}) {
  const rows = Object.entries(FORM_FIELDS)
    .map(
      ([key, label]) => `
    <tr>
      <td style="padding:8px; border:1px solid #ccc; background:#f8f8f8; font-weight:bold;">
        ${escapeHtml(label)}
      </td>
      <td style="padding:8px; border:1px solid #ccc;">
        ${valueOrEmpty(data, key)}
      </td>
    </tr>
  `
    )
    .join("");

  return `
    <div style="font-family:Arial; max-width:700px; margin:auto;">
      <h2 style="text-align:center; color:#007bff;">🚚 Formulaire création référence Pièce PL</h2>
      <table style="width:100%; border-collapse:collapse; margin-top:20px;">
        ${rows}
      </table>
      <p style="margin-top:20px;">📎 Des fichiers sont joints à ce message si fournis.</p>
    </div>
  `;
}

function buildAccuseHtml(data = {}) {
  const rows = Object.entries(FORM_FIELDS)
    .map(
      ([key, label]) => `
    <tr>
      <td style="padding:6px; border:1px solid #eee; background:#f8f8f8; font-weight:bold;">
        ${escapeHtml(label)}
      </td>
      <td style="padding:6px; border:1px solid #eee;">
        ${valueOrEmpty(data, key)}
      </td>
    </tr>
  `
    )
    .join("");

  return `
    <div style="font-family:Arial; max-width:700px; margin:auto;">
      <h2 style="text-align:center; color:#28a745;">✔️ Accusé de réception</h2>
      <p>Votre demande de création de référence <b>Pièce PL</b> a bien été enregistrée.</p>
      <table style="width:100%; border-collapse:collapse; margin-top:20px;">
        ${rows}
      </table>
      <p style="margin-top:20px;">Ceci est un accusé automatique, merci de ne pas répondre.</p>
    </div>
  `;
}

router.post("/submit-form", upload.array("files", 10), async (req, res) => {
  const formData = req.body || {};
  const files = Array.isArray(req.files) ? req.files : [];

  const attachments = files.map((file) => ({
    filename: file.originalname,
    path: file.path,
  }));

  try {
    const destEmail = process.env.DEST_EMAIL_FORMULAIRE_PIECEPL || "";
    if (!destEmail) {
      console.error("[creation-piece-pl] DEST_EMAIL_FORMULAIRE_PIECEPL missing");
      return res.status(500).send("Erreur: destinataire non configuré.");
    }

    const requestId =
      getIdempotencyKey(req) ||
      (crypto.randomUUID
        ? crypto.randomUUID()
        : crypto.randomBytes(16).toString("hex"));

    const mailOptions = {
      from: fromEmail,
      to: destEmail,
      subject: "🧩 Demande de création référence Pièce PL",
      html: buildHtml(formData),
      attachments,
    };

    await enqueueMailJob({
      idempotencyKey: `${requestId}:creation-piece-pl:magasin`,
      mailOptions,
      formType: "creation-piece-pl",
      meta: {
        kind: "magasin",
        demandeur: formData.email || "",
        marque: (formData.marque || "").slice(0, 80),
        fournisseur: (formData.fournisseur || "").slice(0, 80),
        reference: (formData.reference || "").slice(0, 80),
      },
      cleanupPaths: files.map((f) => f.path),
    });

    if (formData.email) {
      const accuseOptions = {
        from: fromEmail,
        to: formData.email,
        subject: "✔️ Accusé de réception - Création référence Pièce PL",
        html: buildAccuseHtml(formData),
      };

      await enqueueMailJob({
        idempotencyKey: `${requestId}:creation-piece-pl:demandeur`,
        mailOptions: accuseOptions,
        formType: "creation-piece-pl",
        meta: { kind: "demandeur", demandeur: formData.email || "" },
        cleanupPaths: [],
      });
    }

    return res.status(202).send("Formulaire enregistré. Envoi en cours…");
  } catch (err) {
    console.error("[creation-piece-pl] enqueue failed:", err);
    return res.status(500).send("Erreur lors de l'enregistrement.");
  }
});

export default router;
