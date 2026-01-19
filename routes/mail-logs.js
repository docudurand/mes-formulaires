import express from "express";
import { getMailLogs } from "../mailLog.js";

const router = express.Router();

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || process.env.MONITOR_TOKEN || "";

function extractAdminToken(req) {
  const headerToken = req.headers["x-admin-token"];
  if (headerToken) return String(headerToken).trim();

  const auth = req.headers.authorization;
  if (auth) {
    const value = String(auth).trim();
    if (value.toLowerCase().startsWith("bearer ")) return value.slice(7).trim();
  }

  const queryToken = req.query?.token;
  if (Array.isArray(queryToken)) return String(queryToken[0] || "").trim();
  if (queryToken != null) return String(queryToken).trim();

  return "";
}

function requireAdmin(req, res, next) {
  const token = extractAdminToken(req);
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

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
