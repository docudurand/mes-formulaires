import express from "express";
import { getMailLogs } from "../mailLog.js";

const router = express.Router();

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

function requireAdmin(req, res, next) {
  const token = req.headers["x-admin-token"];
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
