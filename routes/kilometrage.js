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

router.post("/save", async (req, res) => {
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
      km,
      commentaire
    } = req.body || {};

    if (!codeTournee || !date || km === undefined || km === null || km === "") {
      return res.status(400).json({
        success: false,
        error: "Champs obligatoires manquants (codeTournee, date, km)"
      });
    }

    const payload = {
      agence: agence || codeAgence || "",
      codeAgence: codeAgence || agence || "",
      tournee: tournee || "",
      codeTournee,
      chauffeur: chauffeur || "",
      codeChauffeur: codeChauffeur || "",
      date,
      km: Number(km),
      commentaire: commentaire || ""
    };

    const response = await axios.post(apiUrl, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 10000
    });

    return res.json(response.data || { success: true });
  } catch (err) {
    console.error("Erreur /api/kilometrage/save :", err.message);
    return res
      .status(500)
      .json({ success: false, error: "Erreur lors de l'enregistrement du kilométrage" });
  }
});

router.get("/data", async (req, res) => {
  try {
    const apiUrl = getApiUrl();
    if (!apiUrl) {
      return res
        .status(500)
        .json({ success: false, error: "GS_KILOMETRAGE_URL non configuré" });
    }

    const { agence, year } = req.query;

    const url =
      apiUrl +
      `?agence=${encodeURIComponent(agence || "")}&year=${encodeURIComponent(year || "")}`;

    const response = await axios.get(url, { timeout: 10000 });

    return res.json(response.data || []);
  } catch (err) {
    console.error("Erreur /api/kilometrage/data :", err.message);
    return res
      .status(500)
      .json({ success: false, error: "Erreur lors de la récupération des données" });
  }
});

router.get("/params", async (req, res) => {
  try {
    const apiUrl = getApiUrl();
    if (!apiUrl) {
      return res
        .status(500)
        .json({ success: false, error: "GS_KILOMETRAGE_URL non configuré" });
    }

    const { agence } = req.query;

    const url =
      apiUrl +
      `?mode=params` +
      (agence ? `&agence=${encodeURIComponent(agence)}` : "");

    const response = await axios.get(url, { timeout: 10000 });

    return res.json(response.data || []);
  } catch (err) {
    console.error("Erreur /api/kilometrage/params :", err.message);
    return res
      .status(500)
      .json({ success: false, error: "Erreur lors de la récupération des paramètres" });
  }
});
router.get("/resume", async (req, res) => {
  try {
    const apiUrl = getApiUrl();
    if (!apiUrl) {
      return res
        .status(500)
        .json({ success: false, error: "GS_KILOMETRAGE_URL non configuré" });
    }

    const { agence, codeAgence, codeTournee, date } = req.query;

    const url =
      apiUrl +
      `?mode=resume` +
      `&agence=${encodeURIComponent(agence || "")}` +
      `&codeAgence=${encodeURIComponent(codeAgence || "")}` +
      `&codeTournee=${encodeURIComponent(codeTournee || "")}` +
      `&date=${encodeURIComponent(date || "")}`;

    const response = await axios.get(url, { timeout: 10000 });

    return res.json(response.data || { found: false });
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