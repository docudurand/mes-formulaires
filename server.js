import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import cookieParser from "cookie-parser";
import bodyParser from "body-parser";

import * as stats from "./stats.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(cors());
app.use(cookieParser());
app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "10mb" }));

app.use(express.static(path.join(__dirname, "public")));

app.get("/healthz", (req, res) => {
  res.status(200).send("ok");
});

app.get("/", (req, res) => {
  res.status(200).send("mes-formulaires ok");
});

app.get("/stats/counters", async (req, res) => {
  try {
    const data = await stats.getCounters();
    res.json({ ok: true, data });
  } catch (err) {
    console.error("Erreur /stats/counters:", err);
    res.status(500).json({ ok: false, error: "Erreur de lecture des compteurs" });
  }
});

app.get("/compteur", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "compteur.html"));
});

app.post("/piece", async (req, res) => {
  try {
    await stats.recordSubmission("piece");

    res.status(200).json({ ok: true, message: "Demande pièce VL envoyée" });
  } catch (err) {
    console.error("Erreur /piece:", err);
    res.status(500).json({ ok: false, error: "Erreur serveur /piece" });
  }
});

app.post("/piecepl", async (req, res) => {
  try {

    await stats.recordSubmission("piecepl");

    res.status(200).json({ ok: true, message: "Demande pièce PL envoyée" });
  } catch (err) {
    console.error("Erreur /piecepl:", err);
    res.status(500).json({ ok: false, error: "Erreur serveur /piecepl" });
  }
});

app.post("/pneu", async (req, res) => {
  try {
    await stats.recordSubmission("pneu");

    res.status(200).json({ ok: true, message: "Demande pneumatique envoyée" });
  } catch (err) {
    console.error("Erreur /pneu:", err);
    res.status(500).json({ ok: false, error: "Erreur serveur /pneu" });
  }
});
const PORT = process.env.PORT || 3000;

(async () => {
  try {
    await stats.initCounters();
  } catch (e) {
    console.warn("[COMPTEUR] initCounters a rencontré un souci :", e?.message || e);
  }

  app.listen(PORT, () => {
    console.log(`[MES-FORMULAIRES] Serveur démarré sur port ${PORT}`);
  });
})();