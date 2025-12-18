import { appendEvent, saveSnapshot, loadSnapshot } from "./mailjetFtpStore.js";

const store = new Map();

export async function initMailjetPersistence(){
  try {
    const snap = await loadSnapshot();
    Object.entries(snap || {}).forEach(([k,v]) => store.set(k,v));
  } catch (e) {
    console.warn("[MAILJET] initMailjetPersistence FAILED (boot continues):", e?.message || e);
  }
}

export function upsertStatus(id, patch){
  const cur = store.get(id) || { id };
  const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
  store.set(id, next);

  saveSnapshot(Object.fromEntries(store)).catch((e) => {
    console.warn("[MAILJET] saveSnapshot failed:", e?.message || e);
  });

  return next;
}

export function listStatus(){
  return Array.from(store.values()).sort((a,b)=>
    (b.updatedAt||"").localeCompare(a.updatedAt||"")
  );
}

export async function recordEvent(evt){
  try {
    await appendEvent(evt);
  } catch (e) {
    console.warn("[MAILJET] appendEvent failed:", e?.message || e);
  }
}