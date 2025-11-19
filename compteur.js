import fs from "fs";
import path from "path";

const compteurFile = path.join(process.cwd(), "compteurs.json");

function loadCompteurs() {
  if (!fs.existsSync(compteurFile)) {
    fs.writeFileSync(compteurFile, JSON.stringify({}, null, 2));
  }
  return JSON.parse(fs.readFileSync(compteurFile, "utf8"));
}

function saveCompteurs(data) {
  fs.writeFileSync(compteurFile, JSON.stringify(data, null, 2));
}

export function incrementCompteur(formulaire) {
  const data = loadCompteurs();
  const year = new Date().getFullYear();

  if (!data[formulaire]) data[formulaire] = {};
  if (!data[formulaire][year]) data[formulaire][year] = 0;

  data[formulaire][year] += 1;
  saveCompteurs(data);
}

export function incrementRamasseMagasin(magasin) {
  const data = loadCompteurs();
  const year = new Date().getFullYear();
  const key = String(magasin || "Inconnu").trim() || "Inconnu";

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