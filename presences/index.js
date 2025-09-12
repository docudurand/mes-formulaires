import express from "express";
import axios from "axios";
import fs from "fs";
import os from "os";
import path from "path";
import * as ftp from "basic-ftp";

const CONGES_ADMIN_CODE = process.env.CONGES_ADMIN_CODE || "";
const PRESENCES_BACKEND = (process.env.PRESENCES_BACKEND || "apps_script").toLowerCase();

const FTP_HOST = process.env.FTP_HOST || "";
const FTP_PORT = Number(process.env.FTP_PORT || 21);
const FTP_USER = process.env.FTP_USER || "";
const FTP_PASSWORD = process.env.FTP_PASSWORD || "";
const FTP_SECURE = String(process.env.FTP_SECURE || "false").toLowerCase() === "true";
const FTP_BACKUP_FOLDER = (process.env.FTP_BACKUP_FOLDER || "/Disque 1/service").replace(/\\/g, "/");
const FTP_TLS_REJECT_UNAUTH = String(process.env.FTP_TLS_REJECT_UNAUTH || "1") !== "0";

function normalizeUrl(v) {
  if (!v) return "";
  let s = String(v).trim();

  s = s.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  return s;
}
function getAppsScriptPresencesUrl() {
  const raw =
    process.env.APPS_SCRIPT_PRESENCES ||
    process.env.APPS_SCRIPT_PRESENCES_URL ||
    "";
  return normalizeUrl(raw);
}

const TYPES = ["EMPLOYE", "INTERIM", "LIVREUR"];
const isHalfShift = (cr) => (cr === "MATIN" || cr === "APRÈS-MIDI");
const toISO = (d) => String(d).slice(0, 10);
const yyyyMm = (iso) => String(iso).slice(0, 7);

function slugify(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function monthDays(month) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  const out = [];
  while (d.getMonth() === m - 1) {
    out.push(
      new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
        .toISOString()
        .slice(0, 10)
    );
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function ensureMonth(month) {
  if (!/^\d{4}-\d{2}$/.test(month || "")) throw new Error("bad_month_format");
}
function ensureDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || "")) throw new Error("bad_day_format");
}

const cache = new Map();
function cacheGet(key) {
  const v = cache.get(key);
  if (!v) return null;
  if (Date.now() > v.ts + v.ttlMs) {
    cache.delete(key);
    return null;
  }
  return v.value;
}
function cachePut(key, value, ttlMs = 60_000) {
  cache.set(key, { ts: Date.now(), ttlMs, value });
}

async function getFtpClient() {
  const client = new ftp.Client(25_000);
  await client.access({
    host: FTP_HOST,
    port: FTP_PORT,
    user: FTP_USER,
    password: FTP_PASSWORD,
    secure: FTP_SECURE,
    secureOptions: { rejectUnauthorized: FTP_TLS_REJECT_UNAUTH },
  });
  return client;
}

function remoteDir(store, month) {
  return `${FTP_BACKUP_FOLDER}/presences/${slugify(store)}/${month}`;
}
function remoteFile(store, month, type) {
  return `${remoteDir(store, month)}/${type.toUpperCase()}.json`;
}

async function ftpReadJson(remotePath) {
  const tmp = path.join(os.tmpdir(), `dl-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const client = await getFtpClient();
  try {
    await client.downloadTo(tmp, remotePath);
    const raw = await fs.promises.readFile(tmp, "utf-8");
    return JSON.parse(raw);
  } catch (e) {

    if (String(e?.message || "").match(/No such file|ENOENT|not found|file does not exist|E?550|action not taken|^550/i)) {
      return null;
    }
    throw e;
  } finally {
    try { await fs.promises.unlink(tmp); } catch (_) {}
    client.close();
  }
}

async function ftpWriteJson(remotePath, obj) {
  const str = JSON.stringify(obj, null, 2);
  const tmpLocal = path.join(os.tmpdir(), `ul-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  await fs.promises.writeFile(tmpLocal, str);
  const client = await getFtpClient();
  try {
    const dir = path.posix.dirname(remotePath);
    await client.ensureDir(dir);
    const tmpRemote = `${remotePath}.tmp-${Date.now()}`;
    await client.uploadFrom(tmpLocal, tmpRemote);

    try { await client.remove(remotePath); } catch (_) {}
    await client.rename(tmpRemote, remotePath);
  } finally {
    try { await fs.promises.unlink(tmpLocal); } catch (_) {}
    client.close();
  }
}

function toRecord(date, person_id, shift, code) {
  return { date: toISO(date), person_id: String(person_id), shift: String(shift).toUpperCase(), code: String(code).toUpperCase() };
}

function buildRecordsFromMatrix(dayOrMonth, matrix, shiftsAllowedById = new Map(), codesSet = new Set(), isDay = false) {
  const out = [];
  const days = isDay ? [dayOrMonth] : monthDays(dayOrMonth);
  const daysSet = new Set(days);
  const shiftsAll = new Set(["MATIN", "APRÈS-MIDI", "JOURNEE", "JOURNÉE"]);

  for (const pid of Object.keys(matrix || {})) {
    const per = matrix[pid] || {};
    const allowed = shiftsAllowedById.get(pid) || null;
    for (const k of Object.keys(per)) {
      const maybeDay = k.includes("-") ? k : null;
      if (maybeDay) {

        if (!daysSet.has(maybeDay)) continue;
        const perShift = per[k] || {};
        for (const shiftName of Object.keys(perShift)) {
          const shiftN = normalizeShift(shiftName);
          if (!shiftsAll.has(shiftN)) continue;
          if (allowed && allowed.size && !allowed.has(shiftN)) continue;
          const code = String(perShift[shiftName] || "").toUpperCase();
          if (!code) continue;
          if (codesSet.size && !codesSet.has(code)) continue;
          out.push(toRecord(maybeDay, pid, shiftN, code));
        }
      } else {

        const shiftN = normalizeShift(k);
        if (!shiftsAll.has(shiftN)) continue;
        if (allowed && allowed.size && !allowed.has(shiftN)) continue;
        const code = String(per[k] || "").toUpperCase();
        if (!code) continue;
        if (codesSet.size && !codesSet.has(code)) continue;
        const d = isDay ? dayOrMonth : null;
        if (!d) continue;
        out.push(toRecord(d, pid, shiftN, code));
      }
    }
  }
  return out;
}

function normalizeShift(s) {
  let t = String(s || "").trim().toUpperCase();
  if (t === "AM" || t === "APRES-MIDI") t = "APRÈS-MIDI";
  if (t === "JOURNEE") t = "JOURNÉE";
  return t;
}

function aggregateSummary(records) {
  const agg = new Map();
  for (const r of records || []) {
    const v = isHalfShift(normalizeShift(r.shift)) ? 0.5 : 1;
    const pid = String(r.person_id);
    const code = String(r.code).toUpperCase();
    if (!agg.has(pid)) agg.set(pid, {});
    const a = agg.get(pid);
    a[code] = (a[code] || 0) + v;
  }
  return agg;
}

async function asGet(params, extraHeaders = {}) {
  const url = getAppsScriptPresencesUrl();
  if (!url) throw new Error("apps_script_presences_url_missing");
  const r = await axios.get(url, { params, timeout: 25_000, headers: extraHeaders });
  return r.data;
}
async function asPost(body, extraHeaders = {}) {
  const url = getAppsScriptPresencesUrl();
  if (!url) throw new Error("apps_script_presences_url_missing");
  const r = await axios.post(url, body, { timeout: 25_000, headers: extraHeaders });
  return r.data;
}

const router = express.Router();
router.use(express.json({ limit: "3mb" }));

router.get("/_debug", (_req, res) => {
  res.json({ backend: PRESENCES_BACKEND, APPS_SCRIPT_PRESENCES: !!getAppsScriptPresencesUrl() });
});

router.get("/", async (req, res) => {
  try {
    const action = String(req.query.action || "ping");
    const adminHeader = { "X-Admin-Code": req.get("X-Admin-Code") || "" };

    if (PRESENCES_BACKEND !== "ftp") {

      const data = await asGet(req.query, adminHeader);
      return res.json(data);
    }

    if (action === "stores" || action === "leaves" || action === "ping") {

      const data = await asGet(req.query, adminHeader);
      return res.json(data);
    }

    if (action === "init") {
      const { store = "", type = "", month = "" } = req.query;
      ensureMonth(String(month));
      const ref = await asGet({ action: "init", store, type, month }, adminHeader);
      const rf = remoteFile(store, String(month), String(type));
      const cachedKey = `init:${store}:${type}:${month}`;
      const force = /^1|true$/i.test(String(req.query.force || ""));
      let recs = !force ? cacheGet(cachedKey) : null;
      if (!recs) {
        const json = (await ftpReadJson(rf)) || { records: [] };
        recs = Array.isArray(json.records) ? json.records : [];
        cachePut(cachedKey, recs, 30_000);
      }
      ref.records = recs;
      return res.json(ref);
    }

    if (action === "initDay") {
      const { store = "", type = "", day = "" } = req.query;
      ensureDay(String(day));
      const month = yyyyMm(day);
      const ref = await asGet({ action: "initDay", store, type, day }, adminHeader);
      const rf = remoteFile(store, month, String(type));
      const json = (await ftpReadJson(rf)) || { records: [] };
      const recs = (json.records || []).filter((r) => toISO(r.date) === day);
      ref.records = recs;
      return res.json(ref);
    }

    if (action === "initDayAll") {
      const { store = "", day = "" } = req.query;
      ensureDay(String(day));
      const month = yyyyMm(day);
      const ref = await asGet({ action: "initDayAll", store, day }, adminHeader);
      for (const t of TYPES) {
        const rf = remoteFile(store, month, t);
        const json = (await ftpReadJson(rf)) || { records: [] };
        const recs = (json.records || []).filter((r) => toISO(r.date) === day);
        if (!ref[t]) ref[t] = { people: [], shifts: [], codes: [], records: [] };
        ref[t].records = recs;
      }
      return res.json(ref);
    }

    if (action === "initMonthAll") {
      const { month = "" } = req.query;
      ensureMonth(String(month));
      const ref = await asGet({ action: "initMonthAll", month }, adminHeader);
      for (const storeObj of ref.stores || []) {
        const store = storeObj.store;
        for (const t of TYPES) {
          const rf = remoteFile(store, String(month), t);
          const json = (await ftpReadJson(rf)) || { records: [] };
          if (!storeObj.monthByType[t]) storeObj.monthByType[t] = {};
          storeObj.monthByType[t].records = Array.isArray(json.records) ? json.records : [];
        }
      }
      return res.json(ref);
    }

    if (action === "summary") {
      const { store = "", type = "", month = "" } = req.query;
      ensureMonth(String(month));
      const rf = remoteFile(store, String(month), String(type));
      const json = (await ftpReadJson(rf)) || { records: [] };
      const agg = aggregateSummary(json.records || []);
      const init = await asGet({ action: "init", store, type, month }, adminHeader);
      const rows = (init.people || []).map((p) => {
        const a = agg.get(String(p.id)) || {};
        const rnd = (x) => Math.round((x || 0) * 100) / 100;
        return {
          magasin: p.magasin,
          nom: p.nom,
          prenom: p.prenom,
          type: p.type,
          P: rnd(a["P"]),
          CP: rnd(a["CP"]),
          SS: rnd(a["SS"]),
          F: rnd(a["F"]),
          totalP: rnd(a["P"]),
        };
      });
      return res.json({ rows });
    }

    if (action === "summaryAll") {
      const { type = "", month = "" } = req.query;
      ensureMonth(String(month));
      const storesObj = await asGet({ action: "stores" }, adminHeader);
      const stores = storesObj.stores || [];
      const out = [];
      for (const store of stores) {
        const rf = remoteFile(store, String(month), String(type));
        const json = (await ftpReadJson(rf)) || { records: [] };
        const agg = aggregateSummary(json.records || []);
        const init = await asGet({ action: "init", store, type, month }, adminHeader);
        const rows = (init.people || []).map((p) => {
          const a = agg.get(String(p.id)) || {};
          const rnd = (x) => Math.round((x || 0) * 100) / 100;
          return {
            magasin: p.magasin,
            nom: p.nom,
            prenom: p.prenom,
            type: p.type,
            P: rnd(a["P"]),
            CP: rnd(a["CP"]),
            SS: rnd(a["SS"]),
            F: rnd(a["F"]),
            totalP: rnd(a["P"]),
          };
        });
        out.push({ store, rows });
      }
      return res.json({ ok: true, stores: out });
    }

    return res.status(400).json({ error: "unknown_action" });
  } catch (e) {
    console.error("[PRESENCES][GET]", e?.message || e);
    res.status(500).json({ error: "internal_error", detail: String(e?.message || e) });
  }
});

router.post("/", async (req, res) => {
  try {
    const action = String(req.body?.action || "");

    if (action === "leave_decide") {
      const code = req.get("X-Admin-Code") || req.query.adminCode || req.body?.adminCode;
      if (String(code) !== String(CONGES_ADMIN_CODE)) {
        return res.status(401).json({ error: "unauthorized" });
      }
    }

    if (PRESENCES_BACKEND !== "ftp") {
      const data = await asPost(req.body, { "X-Admin-Code": req.get("X-Admin-Code") || "" });
      return res.json(data);
    }

    if (["leave_request", "leave_decide", "purge_cache"].includes(action)) {
      const data = await asPost(req.body, { "X-Admin-Code": req.get("X-Admin-Code") || "" });
      return res.json(data);
    }

    if (action === "save") {
      const { store = "", type = "", month = "", matrix = {} } = req.body || {};
      ensureMonth(String(month));

      const init = await asPost({ action: "init", store, type, month });
      const people = init.people || [];
      const codesSet = new Set((init.codes || []).map((c) => String(c.code).toUpperCase()));
      const shiftsById = new Map(
        people.map((p) => [String(p.id), new Set((p.allowed || []).map((x) => normalizeShift(x)))])
      );
      const records = buildRecordsFromMatrix(String(month), matrix, shiftsById, codesSet, false);
      const payload = { store, type, month, records, meta: { updated_at: new Date().toISOString() } };
      const rf = remoteFile(store, String(month), String(type));
      await ftpWriteJson(rf, payload);
      cache.delete(`init:${store}:${type}:${month}`);
      return res.json({ ok: true, written: records.length });
    }

    if (action === "saveDay") {
      const { store = "", type = "", day = "", matrix = {} } = req.body || {};
      ensureDay(String(day));
      const month = yyyyMm(day);
      const init = await asPost({ action: "initDay", store, type, day });
      const people = init.people || [];
      const codesSet = new Set((init.codes || []).map((c) => String(c.code).toUpperCase()));
      const shiftsById = new Map(
        people.map((p) => [String(p.id), new Set((p.allowed || []).map((x) => normalizeShift(x)))])
      );
      const add = buildRecordsFromMatrix(String(day), matrix, shiftsById, codesSet, true);

      const rf = remoteFile(store, String(month), String(type));
      const cur = (await ftpReadJson(rf)) || { records: [] };
      const keep = (cur.records || []).filter((r) => toISO(r.date) !== day);
      const next = { store, type, month, records: keep.concat(add), meta: { updated_at: new Date().toISOString() } };
      await ftpWriteJson(rf, next);
      cache.delete(`init:${store}:${type}:${month}`);
      return res.json({ ok: true, written: add.length, deleted: cur.records.length - keep.length });
    }

    if (action === "saveDayAll") {
      const { store = "", day = "", matrices = {} } = req.body || {};
      ensureDay(String(day));
      const month = yyyyMm(day);
      let totalWritten = 0;
      for (const type of TYPES) {
        const init = await asPost({ action: "initDay", store, type, day });
        const people = init.people || [];
        const codesSet = new Set((init.codes || []).map((c) => String(c.code).toUpperCase()));
        const shiftsById = new Map(
          people.map((p) => [String(p.id), new Set((p.allowed || []).map((x) => normalizeShift(x)))])
        );
        const add = buildRecordsFromMatrix(String(day), matrices[type] || {}, shiftsById, codesSet, true);
        const rf = remoteFile(store, String(month), String(type));
        const cur = (await ftpReadJson(rf)) || { records: [] };
        const keep = (cur.records || []).filter((r) => toISO(r.date) !== day);
        const next = { store, type, month, records: keep.concat(add), meta: { updated_at: new Date().toISOString() } };
        await ftpWriteJson(rf, next);
        totalWritten += add.length;
        cache.delete(`init:${store}:${type}:${month}`);
      }
      return res.json({ ok: true, written: totalWritten });
    }

    return res.status(400).json({ error: "unknown_action" });
  } catch (e) {
    console.error("[PRESENCES][POST]", e?.message || e);
    res.status(500).json({ error: "internal_error", detail: String(e?.message || e) });
  }
});

export default router;
