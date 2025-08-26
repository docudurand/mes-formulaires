import fs from "fs";
import path from "path";

const compteurFile = path.join(process.cwd(), "compteurs.json");

function loadCompteurs() {
  if (!fs.existsSync(compteurFile)) {
    fs.writeFileSync(compteurFile, JSON.stringify({}));
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

export function getCompteurs() {
  return loadCompteurs();
}