import { recordFormSubmission, getFormCounters } from "./compteur.js";

export async function initCounters() {
  return getFormCounters();
}

export async function recordSubmission(formType) {
  recordFormSubmission(formType);
}

export async function getCounters() {
  return getFormCounters();
}
