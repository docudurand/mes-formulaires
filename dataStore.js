import { appendEvent, saveSnapshot, loadSnapshot } from "./mailjetFtpStore.js";

const store = new Map();

export async function initMailjetPersistence(){
  const snap = await loadSnapshot();
  Object.entries(snap).forEach(([k,v])=>store.set(k,v));
}

export function upsertStatus(id, patch){
  const cur = store.get(id) || { id };
  const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
  store.set(id, next);
  saveSnapshot(Object.fromEntries(store));
  return next;
}

export function listStatus(){
  return Array.from(store.values()).sort((a,b)=>
    (b.updatedAt||"").localeCompare(a.updatedAt||"")
  );
}

export async function recordEvent(evt){
  await appendEvent(evt);
}