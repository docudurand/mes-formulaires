import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

import * as stats from "./stats.js";

import formtelevente from "./formtelevente/index.js";
import formulairePiece from "./formulaire-piece/index.js";
import formulairePiecePL from "./formulaire-piecepl/index.js";
import formulairePneu from "./formulaire-pneu/index.js";
import suiviDossier from "./suivi-dossier/index.js";
import loansRouter from "./pretvehiculed/server-loans.js";
import congesRouter from "./routes/conges.js";
dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.set("trust proxy", 1);

app.use(cors());
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));
app.use(congesRouter);

app.use((req, res, next) => {
  const url = req.originalUrl || req.url || "";
  const method = req.method;

  res.on("finish", async () => {
    try {
      const success = res.statusCode >= 200 && res.statusCode < 300;
      if (!success || method !== "POST") return;

      if (url.startsWith("/formulaire-piece")) {
        console.log("[COMPTEUR] POST OK sur", url, "-> piece +1");
        await stats.recordSubmission("piece");
      } else if (url.startsWith("/formulaire-piecepl")) {
        console.log("[COMPTEUR] POST OK sur", url, "-> piecepl +1");
        await stats.recordSubmission("piecepl");
      } else if (url.startsWith("/formulaire-pneu")) {
        console.log("[COMPTEUR] POST OK sur", url, "-> pneu +1");
        await stats.recordSubmission("pneu");
      }
    } catch (e) {
      console.warn("[COMPTEUR] post-hook erreur:", e?.message || e);
    }
  });

  next();
});

app.use(
  express.static(path.join(__dirname, "public"), {
    extensions: ["html", "htm"],
    index: false,
  })
);

app.get("/healthz", (_req, res) => res.sendStatus(200));
app.get("/", (_req, res) => {
  res.status(200).send("📝 Mes Formulaires – service opérationnel");
});

app.use("/formtelevente", formtelevente);
app.use("/formulaire-piece", formulairePiece);
app.use("/formulaire-piecepl", formulairePiecePL);
app.use("/formulaire-pneu", formulairePneu);
app.use("/suivi-dossier", suiviDossier);

const pretPublic = path.join(__dirname, "pretvehiculed", "public");
app.use(
  "/pret",
  express.static(pretPublic, { extensions: ["html", "htm"], index: false })
);
app.get("/pret/fiche", (_req, res) => {
  res.sendFile(path.join(pretPublic, "fiche-pret.html"));
});
app.get("/pret/admin", (_req, res) => {
  res.sendFile(path.join(pretPublic, "admin-parc.html"));
});
app.use("/pret/api", loansRouter);

app.get("/stats/counters", async (_req, res) => {
  try {
    const data = await stats.getCounters();
    res.json({ ok: true, data });
  } catch (e) {
    console.error("Erreur /stats/counters:", e);
    res.status(500).json({ ok: false, error: "Erreur de lecture des compteurs" });
  }
});

app.get("/admin/compteurs", async (_req, res) => {
  try {
    const data = await stats.getCounters();
    res.json(data);
  } catch (e) {
    console.error("Erreur /admin/compteurs:", e);
    res.status(500).json({ error: "Erreur de lecture des compteurs" });
  }
});

app.get("/compteur", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "compteur.html"));
});

app.use((_req, res) => res.status(404).json({ error: "Not Found" }));

const PORT = process.env.PORT || 3000;
(async () => {
  try {
    await stats.initCounters();
  } catch (e) {
    console.warn("[COMPTEUR] initCounters souci:", e?.message || e);
  }
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
})();