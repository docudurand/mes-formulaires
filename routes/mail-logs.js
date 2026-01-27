// route admin pour consulter les logs d'emails

import express from "express";
import { getMailLogs } from "../mailLog.js";

// routeur Express separe
const router = express.Router();

// token admin obligatoire pour acceder aux logs
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

function parseBool(value, fallback = false) {
  if (value == null) return fallback;
  const v = String(value).trim().toLowerCase();
  if (v === "") return fallback;
  return v === "1" || v === "true" || v === "yes";
}

// Autorise (ou non) le token
const ADMIN_TOKEN_ALLOW_QUERY = parseBool(process.env.ADMIN_TOKEN_ALLOW_QUERY, true);

// Recupere le token admin
function extractAdminToken(req) {
  const headerToken = req.headers["x-admin-token"];
  if (headerToken) return { token: String(headerToken).trim(), source: "header" };

  const auth = req.headers.authorization;
  if (auth) {
    const value = String(auth).trim();
    if (value.toLowerCase().startsWith("bearer ")) {
      return { token: value.slice(7).trim(), source: "bearer" };
    }
  }

  const queryToken = req.query?.token;
  if (ADMIN_TOKEN_ALLOW_QUERY) {
    if (Array.isArray(queryToken)) return { token: String(queryToken[0] || "").trim(), source: "query" };
    if (queryToken != null) return { token: String(queryToken).trim(), source: "query" };
  }

  return { token: "", source: "none" };
}

// Middleware de protection
function requireAdmin(req, res, next) {
  const { token, source } = extractAdminToken(req);
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: "unauthorized" });
  }
  if (source === "query") {
    console.warn("[ADMIN] token via query string (consider disabling ADMIN_TOKEN_ALLOW_QUERY).");
  }
  next();
}

// API: liste des logs d'emails
router.get("/api/mail-logs", requireAdmin, async (req, res) => {
  try {
    const limit = Number(req.query.limit || 200);
    const q = String(req.query.q || "");
    const data = await getMailLogs({ limit, q });
    res.json(data.logs || data);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

export default router;
