import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { getLastLogs, onLog, getHealthStatus } from "./monitor.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

router.get("/", (_req, res) => {
  return res.sendFile(path.join(__dirname, "..", "public", "monitor.html"));
});

router.get("/health", (_req, res) => {
  return res.status(200).json(getHealthStatus());
});

router.get("/logs", (_req, res) => {
  return res.status(200).json(getLastLogs());
});

router.get("/stream", (req, res) => {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Connection", "keep-alive");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const sendEvent = (event, data) => {
    const payload = JSON.stringify(data);
    res.write(`event: ${event}\n`);
    res.write(`data: ${payload}\n\n`);
  };

  // send existing logs on connect
  try {
    const backlog = getLastLogs();
    backlog.forEach((entry) => sendEvent("log", entry));
  } catch (err) {
    sendEvent("error", { message: err?.message || "stream_backlog_error" });
  }

  const heartbeat = setInterval(() => {
    res.write(":\n\n");
  }, 20000);

  const unsubscribe = onLog((entry) => {
    try {
      sendEvent("log", entry);
    } catch (err) {
      sendEvent("error", { message: err?.message || "stream_error" });
      if (typeof res.end === "function") res.end();
      if (typeof req.destroy === "function") req.destroy();
    }
  });

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

export default router;
