// gestion des compteurs (forms + ramasse) avec sauvegarde FTP

import fs from "fs";
import path from "path";
import ftp from "basic-ftp";

// Fichier local de sauvegarde
const compteurFile = path.join(process.cwd(), "compteurs.json");

// Emplacement FTP principal
function getFtpRemotePath() {
  const root = (process.env.FTP_BACKUP_FOLDER || "/").replace(/\/$/, "");
  return `${root}/compteurs.json`.replace(/\/+/g, "/");
}

// Ancien emplacement FTP
function getLegacyFtpRemotePath() {
  const root = (process.env.FTP_BACKUP_FOLDER || "/").replace(/\/$/, "");
  return `${root}/sauvegardegarantie/counters.json`.replace(/\/+/g, "/");
}

// wrapper FTP (retourne null si FTP non configure)
async function withFtpClient(fn) {
  if (!process.env.FTP_HOST || !process.env.FTP_USER) return null;

  const client = new ftp.Client();
  client.ftp.verbose = false;

  try {
    await client.access({
      host: process.env.FTP_HOST,
      port: Number(process.env.FTP_PORT || 21),
      user: process.env.FTP_USER,
      password: process.env.FTP_PASSWORD,
      secure: String(process.env.FTP_SECURE || "false") === "true",
      secureOptions: {
        rejectUnauthorized:
          String(process.env.FTP_TLS_REJECT_UNAUTH || "1") !== "0",
      },
    });

    return await fn(client);
  } catch (e) {
    console.error("[COMPTEUR][FTP] error:", e.message);
    return null;
  } finally {
    try {
      client.close();
    } catch {
    }
  }
}

// Compteurs par defaut
function defaultFormCounters() {
  return {
    piece: { byYear: {}, total: 0 },
    piecepl: { byYear: {}, total: 0 },
    pneu: { byYear: {}, total: 0 },
  };
}

// Normalise la structure des compteurs
function normalizeCompteursShape(obj) {
  const out = obj && typeof obj === "object" ? obj : {};

  if (!out.ramasseMagasins || typeof out.ramasseMagasins !== "object") {
    out.ramasseMagasins = {};
  }

  if (!out.forms || typeof out.forms !== "object") {
    out.forms = defaultFormCounters();
  } else {
    out.forms = { ...defaultFormCounters(), ...out.forms };

    for (const k of ["piece", "piecepl", "pneu"]) {
      if (!out.forms[k] || typeof out.forms[k] !== "object") {
        out.forms[k] = { byYear: {}, total: 0 };
      }
      if (!out.forms[k].byYear || typeof out.forms[k].byYear !== "object") {
        out.forms[k].byYear = {};
      }
      out.forms[k].total = Number(out.forms[k].total || 0);
    }
  }

  return out;
}

// Telecharge un JSON depuis FTP vers un fichier temporaire
async function downloadJsonFromFtpToTemp(remotePath) {
  const tmp = path.join(process.cwd(), `.tmp-${Date.now()}-${Math.random()}.json`);

  try {
    return await withFtpClient(async (client) => {
      const dir = path.posix.dirname(remotePath);
      try {
        if (dir && dir !== "/") await client.ensureDir(dir);
        await client.downloadTo(tmp, remotePath);
        const raw = fs.readFileSync(tmp, "utf8");
        return JSON.parse(raw);
      } catch (e) {
        console.error("[COMPTEUR][FTP] download error:", e.message);
        return null;
      } finally {
        try {
          if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
        } catch {
        }
      }
    });
  } catch (e) {
    console.error("[COMPTEUR] temp download error:", e.message);
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {}
    return null;
  }
}

// Lecture du fichier principal FTP
async function downloadCompteursFromFtpIfExists() {
  return await downloadJsonFromFtpToTemp(getFtpRemotePath());
}

// Lecture du fichier legacy FTP
async function downloadLegacyCountersFromFtpIfExists() {
  return await downloadJsonFromFtpToTemp(getLegacyFtpRemotePath());
}

// Upload du fichier local vers FTP
async function uploadCompteursToFtp() {
  if (!fs.existsSync(compteurFile)) return;

  await withFtpClient(async (client) => {
    const remotePath = getFtpRemotePath();
    const dir = path.posix.dirname(remotePath);

    try {
      if (dir && dir !== "/") {
        await client.ensureDir(dir);
      }
      await client.uploadFrom(compteurFile, remotePath);
    } catch (e) {
      console.error("[COMPTEUR][FTP] upload error:", e.message);
    }
  });
}

// Detecte l'ancien format
function isLegacyCountersShape(obj) {
  if (!obj || typeof obj !== "object") return false;
  const keys = ["piece", "piecepl", "pneu"];
  return keys.some((k) => obj[k] && typeof obj[k] === "object");
}

// Importe l'ancien format dans le nouveau
function importLegacyIntoCompteurs(base, legacy) {
  const out = normalizeCompteursShape(base);
  const def = defaultFormCounters();

  for (const k of ["piece", "piecepl", "pneu"]) {
    const src = legacy?.[k];
    if (!src || typeof src !== "object") continue;

    const byYear =
      src.byYear && typeof src.byYear === "object" ? src.byYear : {};
    const total = Number(src.total || 0);

    out.forms[k] = {
      byYear: { ...def[k].byYear, ...byYear },
      total: total || 0,
    };
  }

  return normalizeCompteursShape(out);
}

// Init des compteurs
async function initCompteurs() {
  if (fs.existsSync(compteurFile)) {
    try {
      const local = JSON.parse(fs.readFileSync(compteurFile, "utf8"));
      const normalized = normalizeCompteursShape(local);

      try {
        fs.writeFileSync(compteurFile, JSON.stringify(normalized, null, 2), "utf8");
      } catch (e) {
        console.error("[COMPTEUR] Erreur rewrite locale :", e.message);
      }
      return normalized;
    } catch (e) {
      console.error(
        "[COMPTEUR] Erreur lecture locale, tentative FTP :",
        e.message
      );
    }
  }

  const fromFtp = await downloadCompteursFromFtpIfExists();
  if (fromFtp && typeof fromFtp === "object") {
    const normalized = normalizeCompteursShape(fromFtp);
    try {
      fs.writeFileSync(compteurFile, JSON.stringify(normalized, null, 2), "utf8");
    } catch (e) {
      console.error("[COMPTEUR] Erreur écriture locale après FTP :", e.message);
    }
    return normalized;
  }

  const legacy = await downloadLegacyCountersFromFtpIfExists();
  if (legacy && typeof legacy === "object" && isLegacyCountersShape(legacy)) {
    const imported = importLegacyIntoCompteurs({}, legacy);

    try {
      fs.writeFileSync(compteurFile, JSON.stringify(imported, null, 2), "utf8");
    } catch (e) {
      console.error(
        "[COMPTEUR] Erreur écriture locale après import legacy :",
        e.message
      );
    }

    uploadCompteursToFtp().catch((e) =>
      console.error("[COMPTEUR][FTP] upload async error:", e.message)
    );

    return imported;
  }

  const empty = normalizeCompteursShape({});
  try {
    fs.writeFileSync(compteurFile, JSON.stringify(empty, null, 2), "utf8");
  } catch (e) {
    console.error("[COMPTEUR] Erreur écriture fichier compteur :", e.message);
  }
  return empty;
}

// Cache en memoire
let cachedCompteurs = await initCompteurs();

// Lecture du cache
function loadCompteurs() {
  return cachedCompteurs;
}

// Sauvegarde locale + FTP
function saveCompteurs(data) {
  const normalized = normalizeCompteursShape(data);
  cachedCompteurs = normalized;

  try {
    fs.writeFileSync(compteurFile, JSON.stringify(normalized, null, 2), "utf8");
  } catch (e) {
    console.error("[COMPTEUR] Erreur écriture locale :", e.message);
  }

  uploadCompteursToFtp().catch((e) =>
    console.error("[COMPTEUR][FTP] upload async error:", e.message)
  );
}

// Incremente un compteur de formulaire (piece/piecepl/pneu)
export function recordFormSubmission(formType) {
  const type = String(formType || "").toLowerCase();
  if (!["piece", "piecepl", "pneu"].includes(type)) return;

  const data = normalizeCompteursShape(loadCompteurs());
  const year = String(new Date().getFullYear());

  data.forms[type].byYear[year] = Number(data.forms[type].byYear[year] || 0) + 1;
  data.forms[type].total = Number(data.forms[type].total || 0) + 1;

  saveCompteurs(data);
}

// Incremente un compteur generique
export function incrementCompteur(formulaire) {
  const key = String(formulaire || "").trim();
  const lower = key.toLowerCase();

  if (["piece", "piecepl", "pneu"].includes(lower)) {
    recordFormSubmission(lower);
    return;
  }

  const data = loadCompteurs();
  const year = String(new Date().getFullYear());

  if (!data[key] || typeof data[key] !== "object") data[key] = {};
  if (!data[key][year]) data[key][year] = 0;

  data[key][year] += 1;
  saveCompteurs(data);
}

// Incremente le compteur ramasse par magasin
export function incrementRamasseMagasin(magasinRaw) {
  const data = normalizeCompteursShape(loadCompteurs());
  const year = String(new Date().getFullYear());
  const key = String(magasinRaw || "Inconnu").trim() || "Inconnu";

  if (!data.ramasseMagasins[key]) {
    data.ramasseMagasins[key] = { total: 0, byYear: {} };
  }

  const entry = data.ramasseMagasins[key];
  entry.total = Number(entry.total || 0) + 1;
  entry.byYear[year] = Number(entry.byYear[year] || 0) + 1;

  saveCompteurs(data);
}

// Retourne tous les compteurs
export function getCompteurs() {
  return loadCompteurs();
}

// Retourne les compteurs par type de formulaire
export function getFormCounters() {
  const data = normalizeCompteursShape(loadCompteurs());
  const c = data.forms;

  const yearsSet = new Set([
    ...Object.keys(c.piece.byYear || {}),
    ...Object.keys(c.piecepl.byYear || {}),
    ...Object.keys(c.pneu.byYear || {}),
  ]);
  const years = Array.from(yearsSet).sort((a, b) => Number(b) - Number(a));

  return { years, counters: c };
}
