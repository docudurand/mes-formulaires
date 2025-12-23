import fs from "fs";
import path from "path";
import ftp from "basic-ftp";

const compteurFile = path.join(process.cwd(), "compteurs.json");

function getFtpRemotePath() {
  const root = (process.env.FTP_BACKUP_FOLDER || "/").replace(/\/$/, "");
  return `${root}/compteurs.json`.replace(/\/+/g, "/");
}

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

async function downloadCompteursFromFtpIfExists() {
  return await withFtpClient(async (client) => {
    const remotePath = getFtpRemotePath();
    const dir = path.posix.dirname(remotePath);

    try {
      if (dir && dir !== "/") {
        await client.ensureDir(dir);
      }
      await client.downloadTo(compteurFile, remotePath);
      const raw = fs.readFileSync(compteurFile, "utf8");
      return JSON.parse(raw);
    } catch (e) {
      console.error("[COMPTEUR][FTP] download error:", e.message);
      return null;
    }
  });
}

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

async function initCompteurs() {
  if (fs.existsSync(compteurFile)) {
    try {
      return JSON.parse(fs.readFileSync(compteurFile, "utf8"));
    } catch (e) {
      console.error("[COMPTEUR] Erreur lecture locale, tentative FTP :", e.message);
    }
  }

  const fromFtp = await downloadCompteursFromFtpIfExists();
  if (fromFtp && typeof fromFtp === "object") {
    try {
      fs.writeFileSync(compteurFile, JSON.stringify(fromFtp, null, 2), "utf8");
    } catch (e) {
      console.error("[COMPTEUR] Erreur écriture locale après FTP :", e.message);
    }
    return fromFtp;
  }

  try {
    fs.writeFileSync(compteurFile, JSON.stringify({}, null, 2), "utf8");
  } catch (e) {
    console.error("[COMPTEUR] Erreur écriture fichier compteur :", e.message);
  }
  return {};
}

let cachedCompteurs = await initCompteurs();

function loadCompteurs() {
  return cachedCompteurs;
}

function saveCompteurs(data) {
  cachedCompteurs = data;
  try {
    fs.writeFileSync(compteurFile, JSON.stringify(data, null, 2), "utf8");
  } catch (e) {
    console.error("[COMPTEUR] Erreur écriture locale :", e.message);
  }

  uploadCompteursToFtp().catch((e) =>
    console.error("[COMPTEUR][FTP] upload async error:", e.message)
  );
}

export function incrementCompteur(formulaire) {
  const data = loadCompteurs();
  const year = new Date().getFullYear();

  if (!data[formulaire]) data[formulaire] = {};
  if (!data[formulaire][year]) data[formulaire][year] = 0;

  data[formulaire][year] += 1;
  saveCompteurs(data);
}

export function incrementRamasseMagasin(magasinRaw) {
  const data = loadCompteurs();
  const year = new Date().getFullYear();
  const key = String(magasinRaw || "Inconnu").trim() || "Inconnu";

  if (!data.ramasseMagasins) {
    data.ramasseMagasins = {};
  }
  if (!data.ramasseMagasins[key]) {
    data.ramasseMagasins[key] = { total: 0, byYear: {} };
  }

  const entry = data.ramasseMagasins[key];
  entry.total = Number(entry.total || 0) + 1;
  entry.byYear[year] = Number(entry.byYear[year] || 0) + 1;

  saveCompteurs(data);
}

export function getCompteurs() {
  return loadCompteurs();
}

// ---------------------------------------------------------------
//  Nouvelle logique de suivi des visites des pages
//
// Pour tracer le nombre de visites par page ainsi qu'un total global,
// nous stockons ces informations dans le même fichier `compteurs.json`
// sous la clé `pageVisits`. Chaque appel à `incrementPageVisit()`
// incrémente un compteur individuel pour la page ainsi qu'un
// compteur global `__total`. La fonction `getPageVisits()` retourne
// ces informations sous forme d'objet `{ total, pages }`, où
// `pages` est un dictionnaire associant chaque page à son nombre de
// visites et `total` est la somme de toutes les visites.

/**
 * Incrémente le compteur de visites pour une page.
 *
 * @param {string} page - Chemin ou identifiant de la page visitée. Si vide,
 *   ce paramètre sera converti en "/".
 */
export function incrementPageVisit(page) {
  const data = loadCompteurs();
  if (!data.pageVisits) {
    data.pageVisits = { __total: 0 };
  }
  const key = String(page || "").trim() || "/";
  data.pageVisits[key] = (data.pageVisits[key] || 0) + 1;
  data.pageVisits.__total = (data.pageVisits.__total || 0) + 1;
  saveCompteurs(data);
}

/**
 * Retourne les statistiques de visites enregistrées.
 *
 * @returns {{ total: number, pages: { [key: string]: number } }}
 *   Un objet contenant le total global et les visites par page.
 */
export function getPageVisits() {
  const data = loadCompteurs();
  const visits = data.pageVisits || {};
  const total = Number(visits.__total || 0);
  const pages = { ...visits };
  delete pages.__total;
  return { total, pages };
}