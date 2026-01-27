// helpers stats (compteurs de formulaires)

import { recordFormSubmission, getFormCounters } from "./compteur.js";

// Init des compteurs au demarrage
export async function initCounters() {
  return getFormCounters();
}

// Enregistre une soumission de formulaire
export async function recordSubmission(formType) {
  recordFormSubmission(formType);
}

// Recupere les compteurs
export async function getCounters() {
  return getFormCounters();
}
