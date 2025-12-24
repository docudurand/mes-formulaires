import express from "express";
import axios from "axios";

const router = express.Router();

router.use(express.json({ limit: "5mb" }));

function getApiUrl() {
  const url = process.env.GS_KILOMETRAGE_URL;
  if (!url) {
    console.error("GS_KILOMETRAGE_URL non défini dans les variables d'environnement");
  }
  return url;
}

/**
 * POST /api/kilometrage/save
 * Reçoit une saisie km (QR code) et la forward à Apps Script (doPost)
 */
router.post("/save", async (req, res) => {
  try {
    const apiUrl = getApiUrl();
    if (!apiUrl) {
      return res
        .status(500)
        .json({ success: false, error: "GS_KILOMETRAGE_URL non configuré" });
    }

    // On forward tel quel (le doPost attend notamment : agence, codeAgence, tournee, codeTournee,
    // chauffeur, codeChauffeur, date, km, commentaire, id, ...)
    const payload = req.body || {};

    const response = await axios.post(apiUrl, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 20000
    });

    return res.json(response.data || { success: true });
  } catch (err) {
    console.error("Erreur /api/kilometrage/save :", err.message);
    return res
      .status(500)
      .json({ success: false, error: "Erreur lors de l'enregistrement du kilométrage" });
  }
});

/**
 * POST /api/kilometrage/newid
 * Déclare un nouveau chauffeur (génère un nouvel ID) -> Apps Script action=newId
 */
router.post("/newid", async (req, res) => {
  try {
    const apiUrl = getApiUrl();
    if (!apiUrl) {
      return res
        .status(500)
        .json({ success: false, error: "GS_KILOMETRAGE_URL non configuré" });
    }

    const { agence, codeTournee } = req.body || {};
    if (!agence || !codeTournee) {
      return res
        .status(400)
        .json({ success: false, error: "Champs manquants (agence / codeTournee)" });
    }

    const payload = { action: "newId", agence, codeTournee };

    const response = await axios.post(apiUrl, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 20000
    });

    return res.json(response.data || { success: true });
  } catch (err) {
    console.error("Erreur /api/kilometrage/newid :", err.message);
    return res
      .status(500)
      .json({ success: false, error: "Erreur lors de la génération du nouvel ID" });
  }
});

/**
 * POST /api/kilometrage/absent
 * Déclare un chauffeur absent -> Apps Script action=absent
 */
router.post("/absent", async (req, res) => {
  try {
    const apiUrl = getApiUrl();
    if (!apiUrl) {
      return res
        .status(500)
        .json({ success: false, error: "GS_KILOMETRAGE_URL non configuré" });
    }

    const {
      agence,
      codeAgence,
      tournee,
      codeTournee,
      chauffeur,
      codeChauffeur,
      date,
      note
    } = req.body || {};

    if (!agence || !codeTournee || !date) {
      return res.status(400).json({
        success: false,
        error: "Champs obligatoires manquants (agence, codeTournee, date)"
      });
    }

    const payload = {
      action: "absent",
      agence,
      codeAgence: codeAgence || agence,
      tournee: tournee || "",
      codeTournee,
      chauffeur: chauffeur || "",
      codeChauffeur: codeChauffeur || "",
      date,
      note: note || ""
    };

    const response = await axios.post(apiUrl, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 20000
    });

    return res.json(response.data || { success: true });
  } catch (err) {
    console.error("Erreur /api/kilometrage/absent :", err.message);
    return res
      .status(500)
      .json({ success: false, error: "Erreur lors de la déclaration d'absence" });
  }
});

/**
 * GET /api/kilometrage/params?agence=...
 * Récupère les tournées/transporteurs depuis Apps Script (doGet mode=params)
 */
router.get("/params", async (req, res) => {
  try {
    const apiUrl = getApiUrl();
    if (!apiUrl) {
      return res
        .status(500)
        .json({ success: false, error: "GS_KILOMETRAGE_URL non configuré" });
    }

    const { agence } = req.query || {};
    const response = await axios.get(apiUrl, {
      timeout: 20000,
      params: { mode: "params", agence: agence || "" }
    });

    return res.json(response.data || []);
  } catch (err) {
    console.error("Erreur /api/kilometrage/params :", err.message);
    return res
      .status(500)
      .json({ success: false, error: "Erreur lors de la récupération des paramètres" });
  }
});

/**
 * GET /api/kilometrage/data?agence=...&year=...
 * Récupère les données depuis Apps Script (doGet mode=data)
 */
router.get("/data", async (req, res) => {
  try {
    const apiUrl = getApiUrl();
    if (!apiUrl) {
      return res
        .status(500)
        .json({ success: false, error: "GS_KILOMETRAGE_URL non configuré" });
    }

    const { agence, year } = req.query || {};
    const response = await axios.get(apiUrl, {
      timeout: 20000,
      params: { mode: "data", agence: agence || "", year: year || "" }
    });

    return res.json(response.data || []);
  } catch (err) {
    console.error("Erreur /api/kilometrage/data :", err.message);
    return res
      .status(500)
      .json({ success: false, error: "Erreur lors de la récupération des données" });
  }
});

/**
 * (Optionnel) GET /api/kilometrage/resume?agence=...&date=YYYY-MM-DD
 * Retourne les lignes de la journée (filtre côté serveur)
 */
router.get("/resume", async (req, res) => {
  try {
    const apiUrl = getApiUrl();
    if (!apiUrl) {
      return res
        .status(500)
        .json({ success: false, error: "GS_KILOMETRAGE_URL non configuré" });
    }

    const { agence, date } = req.query || {};
    if (!agence || !date) {
      return res.status(400).json({ success: false, error: "Champs manquants (agence / date)" });
    }

    const year = String(date).slice(0, 4);

    const response = await axios.get(apiUrl, {
      timeout: 20000,
      params: { mode: "data", agence: agence || "", year: year || "" }
    });

    const arr = Array.isArray(response.data) ? response.data : [];
    const day = String(date);

    const filtered = arr.filter((r) => {
      const d = (r && r.date) ? String(r.date).slice(0, 10) : "";
      return d === day;
    });

    return res.json({ success: true, rows: filtered });
  } catch (err) {
    console.error("Erreur /api/kilometrage/resume :", err.message);
    return res
      .status(500)
      .json({
        success: false,
        error: "Erreur lors de la récupération du résumé de la journée"
      });
  }
});

export default router;
