// ===== server.js corrigé =====
import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import axios from "axios";

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

// Helpers
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

// Debug
app.get("/api/presences/_debug", (req, res) => {
  const url = getAppsScriptPresencesUrl();
  res.json({
    ok: true,
    has_APPS_SCRIPT_PRESENCES: Boolean(process.env.APPS_SCRIPT_PRESENCES),
    has_APPS_SCRIPT_PRESENCES_URL: Boolean(process.env.APPS_SCRIPT_PRESENCES_URL),
    url_preview: url ? url.slice(0, 60) + (url.length > 60 ? "…" : "") : "",
    ends_with_exec: !!url && url.endsWith("/exec"),
  });
});

// Proxy vers Google Apps Script
app.get("/api/presences", async (req, res) => {
  try {
    const APPS_SCRIPT_PRESENCES = getAppsScriptPresencesUrl();
    if (!APPS_SCRIPT_PRESENCES) {
      return res.status(500).json({ error: "apps_script_presences_url_missing" });
    }

    const r = await axios.get(APPS_SCRIPT_PRESENCES, {
      params: req.query,
      timeout: 20000,
      headers: {
        "X-Force-Reload": req.get("X-Force-Reload") || "",
        "X-Admin-Code": req.get("X-Admin-Code") || "",
      },
    });
    res.status(200).json(r.data);
  } catch (e) {
    console.error("[PRESENCES][GET] proxy_failed:", e?.message || e);
    res.status(502).json({ error: "proxy_failed", message: e?.message || "Bad gateway" });
  }
});

app.post("/api/presences", async (req, res) => {
  try {
    const APPS_SCRIPT_PRESENCES = getAppsScriptPresencesUrl();
    if (!APPS_SCRIPT_PRESENCES) {
      return res.status(500).json({ error: "apps_script_presences_url_missing" });
    }

    const r = await axios.post(APPS_SCRIPT_PRESENCES, req.body, {
      timeout: 30000,
      headers: {
        "X-Force-Reload": req.get("X-Force-Reload") || "",
        "X-Admin-Code": req.get("X-Admin-Code") || "",
      },
    });
    res.status(200).json(r.data);
  } catch (e) {
    console.error("[PRESENCES][POST] proxy_failed:", e?.message || e);
    res.status(502).json({ error: "proxy_failed", message: e?.message || "Bad gateway" });
  }
});

// Serveur statique
app.use(
  express.static(path.join(__dirname, "public"), {
    extensions: ["html", "htm"],
    index: false,
  })
);

app.get("/presences", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "presences", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port " + PORT));
