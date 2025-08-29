// routes/conges.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// --- LOG pour vérifier que le router est chargé et qu'on voit toutes les requêtes
console.log("[CONGES] router loaded");
router.use((req, _res, next) => {
  console.log("[CONGES] hit", req.method, req.originalUrl);
  next();
});

// 1) PING DIAG
router.get("/conges/ping", (_req, res) => res.status(200).send("pong"));

// 2) PAGE (chemin ABSOLU fiable)
router.get("/conges", (_req, res) => {
  const htmlAbs = path.resolve("public", "conges", "index.html"); // <- pas de __dirname ici pour éviter les soucis d'arbo
  res.sendFile(htmlAbs);
});

// 3) API factice pour test (renvoie juste ok)
router.post("/conges/api", (_req, res) => {
  res.json({ ok: true, echo: "api up" });
});

// 4) LOG des non-match dans CE router (pour voir si on passe ici mais sans matcher)
router.all("/conges/*", (req, res) => {
  console.warn("[CONGES] subroute not found in router:", req.originalUrl);
  res.status(404).json({ error: "route_in_router_not_found" });
});

export default router;
