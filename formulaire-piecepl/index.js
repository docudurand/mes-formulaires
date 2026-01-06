import express from "express";
import multer from "multer";
import cors from "cors";
import fs from "fs";
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
router.get("/", (_req, res) => res.send("✅ Formulaire Création Référence PL – OK"));

const UPLOAD_DIR = (process.env.UPLOAD_DIR || "/var/data/uploads").trim();
try {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
} catch {}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safe = String(file.originalname || "file")
      .replace(/[^\w.\-() ]+/g, "_")
      .slice(0, 160);
    cb(null, `${Date.now()}-${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const forbidden = /\.(exe|bat|sh|cmd|js)$/i;
    if (forbidden.test(file.originalname || "")) {
      return cb(new Error("Type de fichier non autorisé."), false);
    }
    cb(null, true);
  },
});

const FIELD_LABELS = {
  email: "Adresse e-mail",
  marque: "Nom de l'équipementier ou code fournisseur",
  reference: "Référence",
  designation: "Désignation => si non précisé sur pièce jointe",
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

function valueOrEmpty(v) {
  return v !== undefined && v !== null && String(v).trim() !== ""
    ? escapeHtml(String(v)).replace(/\n/g, "<br/>")
    : "<em>(non renseigné)</em>";
}

function generateHtml(data = {}) {
  const rows = Object.entries(FIELD_LABELS)
    .map(
      ([key, label]) => `
      <tr>
        <td style="padding:8px; border:1px solid #ccc; background:#f8f8f8; font-weight:bold;">
          ${escapeHtml(label)}
        </td>
        <td style="padding:8px; border:1px solid #ccc;">
          ${valueOrEmpty(data[key])}
        </td>
      </tr>
    `
    )
    .join("");

  return `
    <div style="font-family:Arial,sans-serif; max-width:700px; margin:auto;">
      <h2 style="color:#007bff; text-align:center;">🚚 Formulaire création Référence Poids Lourd</h2>
      <table style="width:100%; border-collapse:collapse; margin-top:20px;">
        ${rows}
      </table>
      <p style="margin-top:20px;">📎 Des fichiers sont joints à ce message si fournis.</p>
    </div>
  `;
}

function accuseHtml(data = {}) {
  const rows = Object.entries(FIELD_LABELS)
    .map(
      ([key, label]) => `
      <tr>
        <td style="padding:6px; border:1px solid #eee; background:#f8f8f8; font-weight:bold;">
          ${escapeHtml(label)}
        </td>
        <td style="padding:6px; border:1px solid #eee;">
          ${valueOrEmpty(data[key])}
        </td>
      </tr>
    `
    )
    .join("");

  return `
    <div style="font-family:Arial,sans-serif; max-width:700px; margin:auto;">
      <h2 style="text-align:center; color:#28a745;">✔️ Accusé de réception</h2>
      <p>Votre demande de création de référence PL a bien été enregistrée.</p>
      <table style="width:100%; border-collapse:collapse; margin-top:20px;">
        ${rows}
      </table>
      <p style="margin-top:20px;">Ceci est un accusé automatique, merci de ne pas répondre.</p>
    </div>
  `;
}

router.post("/submit-form", upload.array("fichiers[]", 10), async (req, res) => {
  const formData = req.body || {};
  const files = Array.isArray(req.files) ? req.files : [];

  const attachments = files.map((f) => ({
    filename: f.originalname,
    path: f.path,
  }));

  try {
    const to =
      process.env.DEST_EMAIL_FORMULAIRE_CREATION_PL ||
      process.env.DEST_EMAIL_FORMULAIRE_PIECEPL ||
      "";

    if (!to) {
      console.error("[creation-reference-pl] DEST_EMAIL_FORMULAIRE_CREATION_PL missing");
      return res.status(500).send("Erreur: destinataire non configuré.");
    }

    const requestId =
      getIdempotencyKey(req) ||
      (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex"));

    await enqueueMailJob({
      idempotencyKey: `${requestId}:creation-reference-pl:magasin`,
      mailOptions: {
        from: `"Formulaire création PL" <${fromEmail}>`,
        to,
        subject: "🚚 Demande de création référence PL",
        replyTo: formData.email || undefined,
        html: generateHtml(formData),
        attachments,
      },
      formType: "creation-reference-pl",
      meta: {
        kind: "magasin",
        demandeur: formData.email || "",
        marque: (formData.marque || "").slice(0, 80),
        reference: (formData.reference || "").slice(0, 80),
      },
      cleanupPaths: files.map((f) => f.path),
    });

    if (formData.email) {
      await enqueueMailJob({
        idempotencyKey: `${requestId}:creation-reference-pl:demandeur`,
        mailOptions: {
          from: `"Formulaire création PL" <${fromEmail}>`,
          to: formData.email,
          subject: "✔️ Accusé de réception - Création Référence PL",
          html: accuseHtml(formData),
        },
        formType: "creation-reference-pl",
        meta: { kind: "demandeur", demandeur: formData.email || "" },
        cleanupPaths: [],
      });
    }

    return res.status(202).send("Formulaire enregistré. Envoi en cours…");
  } catch (err) {
    console.error("[creation-reference-pl] enqueue failed:", err);
    return res.status(500).send("Erreur lors de l'envoi.");
  }
});

export default router;
