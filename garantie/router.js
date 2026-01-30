/**
 * ROUTER GARANTIE – intégration warrantydurand dans mes-formulaires
 * ---------------------------------------------------------------
 * Toutes les routes API sont exposées sous /garantie/api/*
 *
 * Dépendances utilisées :
 * - express, multer, basic-ftp, pdfkit, exceljs, axios
 * - mailer.js existant de mes-formulaires
 */

import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import ftp from "basic-ftp";
import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import axios from "axios";
import mime from "mime-types";
import { fileURLToPath } from "url";
import { transporter, fromEmail } from "../mailer.js";

/* ------------------------------------------------------------------ */
/* Helpers ES modules                                                  */
/* ------------------------------------------------------------------ */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

const FTP_HOST = process.env.FTP_HOST;
const FTP_PORT = Number(process.env.FTP_PORT || 21);
const FTP_USER = process.env.FTP_USER;
const FTP_PASS = process.env.FTP_PASS;
const FTP_BACKUP_FOLDER =
  process.env.FTP_BACKUP_FOLDER || "/Disque 1/sauvegardegarantie";

const JSON_FILE = path.posix.join(FTP_BACKUP_FOLDER, "demandes.json");
const UPLOADS_DIR = path.posix.join(FTP_BACKUP_FOLDER, "uploads");

const MAGASIN_MAILS = safeParseJSON(process.env.MAGASIN_MAILS_JSON);
const FOURNISSEUR_MAILS = safeParseJSON(process.env.FOURNISSEUR_MAILS_JSON);

/* ------------------------------------------------------------------ */
/* Express / Multer                                                    */
/* ------------------------------------------------------------------ */

const router = express.Router();

const TEMP_UPLOAD_DIR = path.join(__dirname, "tmp");
fs.mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });

const upload = multer({ dest: TEMP_UPLOAD_DIR });

/* ------------------------------------------------------------------ */
/* Utils                                                               */
/* ------------------------------------------------------------------ */

function safeParseJSON(v) {
  if (!v) return {};
  try {
    return JSON.parse(v);
  } catch {
    return {};
  }
}

async function getFTP() {
  const client = new ftp.Client();
  client.ftp.verbose = false;

  await client.access({
    host: FTP_HOST,
    port: FTP_PORT,
    user: FTP_USER,
    password: FTP_PASS,
    secure: true,
    secureOptions: { rejectUnauthorized: false },
  });

  return client;
}

async function readJSON() {
  let client;
  try {
    client = await getFTP();
    const tmp = path.join(__dirname, "demandes.tmp.json");
    await client.downloadTo(tmp, JSON_FILE);

    const data = JSON.parse(fs.readFileSync(tmp, "utf8"));
    fs.unlinkSync(tmp);
    client.close();
    return Array.isArray(data) ? data : [];
  } catch {
    if (client) client.close();
    return [];
  }
}

async function writeJSON(data) {
  const tmp = path.join(__dirname, "demandes.tmp.json");
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));

  const client = await getFTP();
  await client.ensureDir(FTP_BACKUP_FOLDER);
  await client.uploadFrom(tmp, JSON_FILE);
  client.close();
  fs.unlinkSync(tmp);
}

function uid() {
  return (
    Date.now().toString(36) +
    Math.random().toString(36).substring(2, 8)
  );
}

/* ------------------------------------------------------------------ */
/* ROUTES API                                                          */
/* ------------------------------------------------------------------ */

/**
 * POST /garantie/api/demandes
 * Création d'une demande de garantie
 */
router.post(
  "/demandes",
  upload.array("document"),
  async (req, res) => {
    try {
      const dossiers = await readJSON();
      const id = uid();

      const dossier = {
        id,
        date: new Date().toISOString(),
        statut: "enregistré",
        ...req.body,
        documents: [],
      };

      /* Upload fichiers vers FTP */
      if (req.files?.length) {
        const client = await getFTP();
        await client.ensureDir(UPLOADS_DIR);

        for (const file of req.files) {
          const ext = path.extname(file.originalname);
          const name = `${id}_${Date.now()}${ext}`;
          const remote = path.posix.join(UPLOADS_DIR, name);

          await client.uploadFrom(file.path, remote);
          fs.unlinkSync(file.path);

          dossier.documents.push({
            name: file.originalname,
            path: remote,
            type: mime.lookup(file.originalname),
          });
        }

        client.close();
      }

      dossiers.push(dossier);
      await writeJSON(dossiers);

      /* Mail client */
      if (transporter && req.body.email) {
        await transporter.sendMail({
          from: fromEmail,
          to: req.body.email,
          subject: "Votre demande de garantie",
          text:
            "Votre demande de Garantie a été envoyée avec succès.\n\n" +
            "Cordialement\nL'équipe Durand Services Garantie.",
        });
      }

      /* Mail magasin */
      const mailMagasin = MAGASIN_MAILS[req.body.magasin];
      if (transporter && mailMagasin) {
        await transporter.sendMail({
          from: fromEmail,
          to: mailMagasin,
          subject: "Nouvelle demande de garantie",
          text: `Nouvelle demande de garantie pour le magasin ${req.body.magasin}`,
        });
      }

      res.json({ success: true });
    } catch (e) {
      console.error("[GARANTIE] erreur POST /demandes", e);
      res.status(500).json({ success: false, message: e.message });
    }
  }
);

/**
 * GET /garantie/api/admin/dossiers
 */
router.get("/admin/dossiers", async (_req, res) => {
  const dossiers = await readJSON();
  res.json(dossiers);
});

/**
 * PUT /garantie/api/admin/dossiers/:id
 */
router.put("/admin/dossiers/:id", async (req, res) => {
  const dossiers = await readJSON();
  const idx = dossiers.findIndex((d) => d.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ error: "Dossier introuvable" });
  }

  dossiers[idx] = { ...dossiers[idx], ...req.body };
  await writeJSON(dossiers);
  res.json({ success: true });
});

/**
 * GET /garantie/api/admin/export-excel
 */
router.get("/admin/export-excel", async (_req, res) => {
  const dossiers = await readJSON();

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Garanties");

  ws.columns = Object.keys(dossiers[0] || {}).map((k) => ({
    header: k,
    key: k,
    width: 25,
  }));

  dossiers.forEach((d) => ws.addRow(d));

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader(
    "Content-Disposition",
    "attachment; filename=garanties.xlsx"
  );

  await wb.xlsx.write(res);
  res.end();
});

/* ------------------------------------------------------------------ */

export default router;
