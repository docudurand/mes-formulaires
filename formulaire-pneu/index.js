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
  email:       "Adresse e-mail",
  fournisseur: "Fournisseur de Réappro",
  ean:         "EAN",
  cai:         "CAI",
  adherence:   "Adhérence sol mouillé",
  conso:       "Consommation carburant",
  sonore:      "Niveau sonore",
  classe:      "Classe de performance",
  designation: "Désignation Pneu",
  prixBF:      "Prix BF",
  prixAchat:   "Prix d'achat"
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
    ? escapeHtml(String(v))
    : "<em>(non renseigné)</em>";
}

function generateHtml(data = {}) {
  const rows = Object.entries(FIELD_LABELS)
    .map(([key, label]) => `
      <tr>
        <td style="padding:8px; border:1px solid #ccc; background:#f8f8f8; font-weight:bold;">
          ${escapeHtml(label)}
        </td>
        <td style="padding:8px; border:1px solid #ccc;">
          ${valueOrEmpty(data[key])}
        </td>
      </tr>
    `)
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

function accuseHtml(data = {}) {
  return `
    <div style="font-family:Arial,sans-serif; max-width:700px; margin:auto;">
      <h2 style="text-align:center; color:#28a745;">✔️ Accusé de réception</h2>
      <p>Bonjour,</p>
      <p>Nous avons bien reçu votre demande de création de référence pneumatique VL.</p>
      <p>Nous la traiterons dans les plus brefs délais.<br><b>Résumé de votre demande :</b></p>
      <table style="width:100%; border-collapse:collapse; margin-top:10px;">
        ${Object.entries(FIELD_LABELS).map(([key, label]) => `
          <tr>
            <td style="padding:6px; border:1px solid #eee; background:#f8f8f8; font-weight:bold;">
              ${escapeHtml(label)}
            </td>
            <td style="padding:6px; border:1px solid #eee;">
              ${valueOrEmpty(data[key])}
            </td>
          </tr>
        `).join("")}
      </table>
      <p style="margin-top:20px;">Ceci est un accusé automatique, merci de ne pas répondre.</p>
      <p>L’équipe Pneumatiques VL</p>
    </div>
  `;
}

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
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const forbidden = /\.(exe|bat|sh|cmd|js)$/i;
    if (forbidden.test(file.originalname)) {
      return cb(new Error("Type de fichier non autorisé."), false);
    }
    cb(null, true);
  }
});

router.post("/submit-form", upload.array("fichiers[]", 10), async (req, res) => {
  const formData = req.body || {};
  const files = Array.isArray(req.files) ? req.files : [];

  const attachments = files.map((file) => ({
    filename: file.originalname,
    path: file.path,
  }));

  try {
    const to = process.env.DEST_EMAIL_FORMULAIRE_PNEU || "";
    if (!to) {
      console.error("[formulaire-pneu] DEST_EMAIL_FORMULAIRE_PNEU missing");
      return res.status(500).send("Erreur d'envoi: destinataire non configuré.");
    }

    const requestId =
      getIdempotencyKey(req) ||
      (crypto.randomUUID
        ? crypto.randomUUID()
        : crypto.randomBytes(16).toString("hex"));

    const mailOptions = {
      from: `"Formulaire création Pneu VL" <${fromEmail}>`,
      to,
      subject: "📨 Demande de création référence Pneumatique VL",
      replyTo: formData.email || undefined,
      html: generateHtml(formData),
      attachments,
    };

    await enqueueMailJob({
      idempotencyKey: `${requestId}:creation-pneu-vl:magasin`,
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

    if (formData.email) {
      const accuseOptions = {
        from: `"Service Pneumatiques VL" <${fromEmail}>`,
        to: formData.email,
        subject: "Votre demande de création de référence pneu a bien été reçue",
        html: accuseHtml(formData),
      };

      await enqueueMailJob({
        idempotencyKey: `${requestId}:creation-pneu-vl:demandeur`,
        mailOptions: accuseOptions,
        formType: "creation-pneu-vl",
        meta: { kind: "demandeur", demandeur: formData.email || "" },
        cleanupPaths: [],
      });
    }

    return res.status(202).send("Formulaire enregistré. Envoi en cours…");
  } catch (err) {
    console.error("[formulaire-pneu] enqueue failed:", err);
    return res.status(500).send("Erreur lors de l'envoi.");
  }
});

export default router;
