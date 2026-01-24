import express from "express";
import axios from "axios";

const router = express.Router();

// ============ LOGS ============
function nowIso() { return new Date().toISOString(); }

function safeJson(obj, maxLen = 2000) {
  try {
    const s = JSON.stringify(obj);
    return s.length > maxLen ? s.slice(0, maxLen) + "…(truncated)" : s;
  } catch {
    return "[unserializable]";
  }
}

function redactedBody(body) {
  // Aucun secret ici normalement, mais on évite d'imprimer des gros payloads.
  // On garde juste les champs utiles.
  if (!body || typeof body !== "object") return body;
  const pick = (k) => (body[k] === undefined ? undefined : body[k]);
  const out = {
    action: pick("action"),
    magasin: pick("magasin"),
    tourneeId: pick("tourneeId"),
    bon: pick("bon"),
    tournee: pick("tournee"),
    codeTournee: pick("codeTournee"),
    livreurId: pick("livreurId"),
    livreur: pick("livreur"),
    gpsLat: pick("gpsLat"),
    gpsLng: pick("gpsLng"),
    gpsAcc: pick("gpsAcc"),
    gpsTs: pick("gpsTs"),
    gps: pick("gps")
  };
  return out;
}

router.use((req, res, next) => {
  // Log début requête (navette uniquement)
  console.log(`[NAVETTE] ${nowIso()} ${req.method} ${req.originalUrl}`);
  next();
});

// ============ HELPERS ============
function mustEnv(name) {
  const v = String(process.env[name] || "").trim();
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function axiosErrorDetails(err) {
  // Donne un message exploitable dans Render logs
  const isAxios = !!(err && err.isAxiosError);
  const status = err?.response?.status;
  const data = err?.response?.data;
  const code = err?.code;
  const msg = err?.message || String(err);

  return {
    isAxios,
    code,
    status,
    message: msg,
    responseData: data
  };
}

async function callGAS(action, params) {
  const url = mustEnv("NAVETTE_GAS_URL");
  const key = mustEnv("NAVETTE_API_KEY");

  const payload = new URLSearchParams({ action, key, ...params });

  try {
    const { data } = await axios.post(url, payload.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 30000
    });
    return data;
  } catch (err) {
    const details = axiosErrorDetails(err);
    console.error("[NAVETTE][GAS ERROR]", safeJson({ action, params, details }));
    // On remonte un message clair au front
    const e = new Error(
      details.status
        ? `GAS HTTP ${details.status}`
        : `GAS request failed${details.code ? " (" + details.code + ")" : ""}`
    );
    e.details = details;
    throw e;
  }
}

function normGps(reqBody) {
  const b = reqBody || {};
  const gpsObj = b.gps && typeof b.gps === "object" ? b.gps : null;

  // Compat: certains envoient lat/lng ou latitude/longitude
  const lat =
    b.gpsLat ?? gpsObj?.gpsLat ?? gpsObj?.lat ?? gpsObj?.latitude ?? b.lat ?? b.latitude;
  const lng =
    b.gpsLng ?? gpsObj?.gpsLng ?? gpsObj?.lng ?? gpsObj?.longitude ?? b.lng ?? b.longitude;
  const acc = b.gpsAcc ?? gpsObj?.gpsAcc ?? gpsObj?.acc ?? b.acc;
  const ts = b.gpsTs ?? gpsObj?.gpsTs ?? gpsObj?.ts ?? b.ts;

  return {
    gpsLat: lat === undefined || lat === null ? "" : String(lat),
    gpsLng: lng === undefined || lng === null ? "" : String(lng),
    gpsAcc: acc === undefined || acc === null ? "" : String(acc),
    gpsTs:  ts  === undefined || ts  === null ? "" : String(ts)
  };
}

function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}


// ============ BULK JOBS (fire-and-forget) ============
const BULK_JOBS = new Map(); // jobId -> {status, createdAt, doneAt, result, error}
function createJobId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function setJob(jobId, patch) {
  const prev = BULK_JOBS.get(jobId) || {};
  BULK_JOBS.set(jobId, { ...prev, ...patch });
}
function getJob(jobId) {
  return BULK_JOBS.get(jobId) || null;
}
// Nettoyage simple (garde 24h)
setInterval(() => {
  const now = Date.now();
  for (const [id, j] of BULK_JOBS.entries()) {
    const t = j?.createdAt || now;
    if (now - t > 24*3600*1000) BULK_JOBS.delete(id);
  }
}, 30*60*1000).unref?.();

// ============ ROUTES ============

router.post("/import", asyncRoute(async (req, res) => {
  console.log("[NAVETTE][/import] body=", safeJson(redactedBody(req.body)));
  const { magasin, bons, tourneeId, tournee, codeTournee } = req.body || {};
  const data = await callGAS("importList", {
    magasin: String(magasin || ""),
    bons: String(bons || ""),
    tourneeId: String(tourneeId || ""),
    tournee: String(tournee || ""),
    codeTournee: String(codeTournee || "")
  });
  res.json(data);
}));

router.post("/valider", asyncRoute(async (req, res) => {
  console.log("[NAVETTE][/valider] body=", safeJson(redactedBody(req.body)));
  const { tourneeId, magasin, livreurId, livreur, bon, tournee, codeTournee } = req.body || {};
  const gps = normGps(req.body);

  const data = await callGAS("scanValider", {
    tourneeId: String(tourneeId || ""),
    magasin: String(magasin || ""),
    livreurId: String((livreurId || livreur || "")).trim(),
    bon: String(bon || ""),
    tournee: String(tournee || ""),
    codeTournee: String(codeTournee || ""),
    ...gps
  });
  res.json(data);
}));

router.post("/livrer", asyncRoute(async (req, res) => {
  console.log("[NAVETTE][/livrer] body=", safeJson(redactedBody(req.body)));
  const { tourneeId, magasin, livreurId, livreur, bon, tournee, codeTournee } = req.body || {};
  const gps = normGps(req.body);

  const data = await callGAS("scanLivrer", {
    tourneeId: String(tourneeId || ""),
    magasin: String(magasin || ""),
    livreurId: String((livreurId || livreur || "")).trim(),
    bon: String(bon || ""),
    tournee: String(tournee || ""),
    codeTournee: String(codeTournee || ""),
    ...gps
  });
  res.json(data);
}));


// Fire-and-forget bulk: envoie une liste de bons en 1 requête.
// Body: { mode: "valider"|"livrer", magasin, tourneeId, tournee, codeTournee, livreurId, livreur, bons:[], gpsLat,gpsLng,gpsAcc,gpsTs, gps:{...} }
router.post("/bulk", asyncRoute(async (req, res) => {
  console.log("[NAVETTE][/bulk] body=", safeJson(redactedBody(req.body)));

  const { mode, magasin, tourneeId, tournee, codeTournee, livreurId, livreur, bons } = req.body || {};
  const gps = normGps(req.body);

  const list = Array.isArray(bons)
    ? bons.map(String).map(s => s.trim()).filter(Boolean)
    : String(bons || "").split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);

  if (!list.length) {
    return res.status(400).json({ success:false, error:"Aucun bon fourni" });
  }

  const jobId = createJobId();
  setJob(jobId, { status:"queued", createdAt: Date.now(), mode: String(mode||"") });

  // Réponse immédiate (le traitement continue côté serveur)
  res.status(202).json({ success:true, queued:true, jobId, count:list.length });

  // Lancement async
  setImmediate(async () => {
    try {
      setJob(jobId, { status:"running" });
      const data = await callGAS("bulkScan", {
        mode: String(mode || "valider"),
        tourneeId: String(tourneeId || ""),
        magasin: String(magasin || ""),
        livreurId: String((livreurId || livreur || "")).trim(),
        tournee: String(tournee || ""),
        codeTournee: String(codeTournee || ""),
        bons: JSON.stringify(list),
        ...gps
      });
      setJob(jobId, { status:"done", doneAt: Date.now(), result: data });
    } catch (err) {
      console.error("[NAVETTE][/bulk][JOB ERROR]", safeJson(axiosErrorDetails(err)));
      setJob(jobId, { status:"error", doneAt: Date.now(), error: String(err?.message || err) });
    }
  });
}));

// Statut d'un job bulk
router.get("/bulk/status", asyncRoute(async (req, res) => {
  const jobId = String(req.query.jobId || "").trim();
  if (!jobId) return res.status(400).json({ success:false, error:"jobId manquant" });
  const job = getJob(jobId);
  if (!job) return res.status(404).json({ success:false, error:"jobId inconnu" });
  res.json({ success:true, job });
}));

// Ping (pour vérifier que Render a bien déployé la bonne version)
router.get("/ping", (req, res) => res.json({ success:true, ts: nowIso() }));

router.get("/active", asyncRoute(async (req, res) => {
  console.log("[NAVETTE][/active] query=", safeJson(req.query));
  const magasin = String(req.query.magasin || "");
  const data = await callGAS("getActiveTournee", { magasin });
  res.json(data);
}));

router.get("/magasins", asyncRoute(async (req, res) => {
  console.log("[NAVETTE][/magasins]");
  const data = await callGAS("getMagasins", {});
  res.json(data);
}));

router.get("/dashboard", asyncRoute(async (req, res) => {
  console.log("[NAVETTE][/dashboard] query=", safeJson(req.query));
  const magasin = String(req.query.magasin || "");
  const data = await callGAS("getDashboard", { magasin });
  res.json(data);
}));

router.get("/livreur", asyncRoute(async (req, res) => {
  console.log("[NAVETTE][/livreur] query=", safeJson(req.query));
  const { tourneeId, magasin, livreurId, livreur } = req.query || {};
  const data = await callGAS("getLivreur", {
    tourneeId: String(tourneeId || ""),
    magasin: String(magasin || ""),
    livreurId: String((livreurId || livreur || "")).trim()
  });
  res.json(data);
}));

// ============ ERROR HANDLER (IMPORTANT) ============
router.use((err, req, res, next) => {
  const details = err?.details ? err.details : undefined;
  console.error("[NAVETTE ERROR]", safeJson({
    at: nowIso(),
    method: req.method,
    url: req.originalUrl,
    message: err?.message || String(err),
    details
  }));
  res.status(500).json({
    success: false,
    error: String(err?.message || err),
    details: details || undefined
  });
});

export default router;
