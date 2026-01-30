// Module garantie - Routes pour la gestion des demandes de garantie
import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { transporter, fromEmail } from "../mailer.js";
import mime from "mime-types";
import ftp from "basic-ftp";
import { fileURLToPath } from "url";
import PDFDocument from "pdfkit";
import axios from "axios";
import ExcelJS from "exceljs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();

const STATUTS = {
  ENREGISTRE: "enregistré",
  ACCEPTE: "accepté",
  REFUSE: "refusé",
  ATTENTE_INFO: "Avoir Commercial",
  ATTENTE_MO: "Attente MO",
};

const MAGASINS = [
  "Annemasse", "Bourgoin-Jallieu", "Chasse-sur-Rhone", "Chassieu", "Gleize", "La Motte-Servolex",
  "Les Echets", "Pavi", "Rives", "Saint-Egreve", "Saint-Jean-Bonnefonds", "Saint-martin-d'heres", "Seynod"
];

// Lit une variable d'env JSON et renvoie {} si invalide.
function parseEnvJsonObject(varName) {
  const raw0 = (process.env[varName] || "").trim();
  if (!raw0) return {};

  let raw = raw0;
  const first = raw[0];
  const last = raw[raw.length - 1];
  if ((first === "'" || first === '"' || first === "`") && last === first) {
    raw = raw.slice(1, -1).trim();
  }

  try {
    const obj = JSON.parse(raw);
    return (obj && typeof obj === "object") ? obj : {};
  } catch (e) {
    console.warn(`[CONF] Impossible de parser ${varName}:`, e?.message || e);
    return {};
  }
}

const MAGASIN_MAILS = parseEnvJsonObject("MAGASIN_MAILS_JSON");
const FOURNISSEUR_MAILS = parseEnvJsonObject("FOURNISSEUR_MAILS_JSON");

const FOURNISSEUR_PDFS = {
  "FEBI": "FICHE_GARANTIE_FEBI.pdf",
  "METELLI": "formulaire_garantie_metelli.pdf",
  "EFI": "Formulaire_EFI.pdf",
  "MAGNETI": "FORMULAIRE_MAGNETI.pdf",
  "QH": "FORMULAIRE_QH.pdf",
  "RIAL": "DEMANDE_RIAL.pdf",
  "AUTOGAMMA": "Formulaire_ AUTOGAMMA.pdf",
  "DELPHI": "Formulaire_delphi.pdf",
  "MS MOTORS": "FORMULAIRE_ms.pdf",
  "NGK": "Formulaire_ngk.pdf",
  "NRF": "Formulaire_nrf.pdf",
  "SEIM": "Formulaire_SEIM.pdf"
};

const FTP_HOST = process.env.FTP_HOST;
const FTP_PORT = Number(process.env.FTP_PORT || 21);
const FTP_USER = process.env.FTP_USER;
const FTP_PASS = process.env.FTP_PASS;
const FTP_BACKUP_FOLDER = process.env.GARANTIE_FTP_BACKUP_FOLDER || "/Disque 1/sauvegardegarantie";
const JSON_FILE_FTP = path.posix.join(FTP_BACKUP_FOLDER, "demandes.json");
const UPLOADS_FTP = path.posix.join(FTP_BACKUP_FOLDER, "uploads");

const TEMP_UPLOAD_DIR = path.join(__dirname, "../temp_uploads_garantie");
try { fs.mkdirSync(TEMP_UPLOAD_DIR, { recursive: true }); } catch {}
const upload = multer({ dest: TEMP_UPLOAD_DIR });

// Ouvre une connexion FTP configuree et renvoie le client.
async function getFTPClient() {
  const client = new ftp.Client(10000);
  client.ftp.verbose = false;
  try {
    await client.access({
      host: FTP_HOST,
      port: FTP_PORT,
      user: FTP_USER,
      password: FTP_PASS,
      secure: true,
      secureOptions: { rejectUnauthorized: false }
    });
    return client;
  } catch (err) {
    client.close();
    console.error("[GARANTIE][FTP] Erreur de connexion :", err && err.message ? err.message : err);
    throw new Error("Erreur de connexion au serveur FTP");
  }
}

// Lit demandes.json sur le FTP et renvoie un tableau.
async function readDataFTP() {
  let client;
  try {
    client = await getFTPClient();
  } catch (err) {
    console.error("[GARANTIE][FTP] Impossible de se connecter pour lire demandes.json :", err.message || err);
    return [];
  }
  let json = [];
  try {
    const tmp = path.join(__dirname, "temp_demandes.json");
    await client.downloadTo(tmp, JSON_FILE_FTP);
    try {
      json = JSON.parse(fs.readFileSync(tmp, "utf8"));
    } catch (parseErr) {
      console.error("[GARANTIE][FTP] Erreur de parsing de demandes.json :", parseErr.message || parseErr);
      json = [];
    }
    try { fs.unlinkSync(tmp); } catch {}
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    if (msg.includes("Server sent FIN packet unexpectedly")) {
      console.warn("[GARANTIE][FTP] FIN inattendu en lecture de demandes.json, retour d'une liste vide.");
    } else {
      console.error("[GARANTIE][FTP] Erreur lors de la lecture de demandes.json :", msg);
    }
    json = [];
  } finally {
    if (client) client.close();
  }
  if (Array.isArray(json)) {
    json.forEach(d => {
      if (d && typeof d.statut === "string") {
        if (d.statut.toLowerCase() === "en attente d'info") {
          d.statut = STATUTS.ATTENTE_INFO;
        }
      }
    });
  }
  return json;
}

// Ecrit demandes.json sur le FTP avec les nouvelles donnees.
async function writeDataFTP(data) {
  let client;
  try {
    client = await getFTPClient();
  } catch (err) {
    console.error("[GARANTIE][FTP] Impossible de se connecter pour écrire demandes.json :", err.message || err);
    throw new Error("Impossible de se connecter au FTP pour sauvegarder les données.");
  }
  const tmp = path.join(__dirname, "temp_demandes.json");
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    await client.ensureDir(FTP_BACKUP_FOLDER);
    await client.uploadFrom(tmp, JSON_FILE_FTP);
    console.log(`[GARANTIE][SAVE] demandes.json mis à jour (${data.length} dossiers)`);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    if (msg.includes("Server sent FIN packet unexpectedly")) {
      console.error("[GARANTIE][FTP] FIN inattendu pendant l'écriture de demandes.json :", msg);
    } else {
      console.error("[GARANTIE][FTP] Erreur lors de l'écriture de demandes.json :", msg);
    }
    throw new Error("Erreur lors de la sauvegarde des données sur le FTP.");
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
    if (client) client.close();
  }
}

