// API Routes pour le module atelier avec données JSON/FTP
import express from "express";
import FTPDataManager from "./ftp-data-manager.js";

const router = express.Router();
const dataManager = new FTPDataManager();

// Middleware pour parser le JSON
router.use(express.json());

// POST /api/submit - Route pour le formulaire de demande (compatibilité avec l'ancien système)
router.post("/api/submit", async (req, res) => {
  try {
    const { payload } = req.body;
    
    if (!payload) {
      return res.status(400).json({
        ok: false,
        error: "Payload manquant"
      });
    }
    
    // Extraire les données du payload
    const header = payload.header || {};
    const snapshot = payload;
    
    // Créer le nouveau dossier
    const caseData = {
      magasin: header.magasin || "",
      compte: header.compte || "",
      client: header.client || "",
      service: header.service || "",
      demandeDate: header.dateDemande || new Date().toISOString().split('T')[0],
      status: "Demande envoyé",
      estimation: null,
      snapshot: snapshot
    };
    
    const newCase = await dataManager.addCase(caseData);
    
    res.json({
      ok: true,
      no: newCase.no,
      message: "Demande enregistrée avec succès"
    });
  } catch (error) {
    console.error("Erreur POST /api/submit:", error);
    res.status(500).json({
      ok: false,
      error: "Erreur lors de l'enregistrement de la demande"
    });
  }
});

// GET /api/config - Route pour charger les lignes et règles (compatibilité)
router.get("/api/config", async (req, res) => {
  try {
    const type = req.query.type;
    
    if (type === 'atelier') {
      const lignes = await dataManager.getLignes();
      const regles = await dataManager.getReglesRef();
      
      res.json({
        lignes: lignes,
        regles: regles
      });
    } else {
      res.json({
        lignes: [],
        regles: []
      });
    }
  } catch (error) {
    console.error("Erreur GET /api/config:", error);
    res.status(500).json({
      error: "Erreur lors du chargement de la configuration"
    });
  }
});

// GET /api/cases - Récupérer tous les dossiers (avec filtres optionnels)
router.get("/api/cases", async (req, res) => {
  try {
    const filters = {
      status: req.query.status,
      magasin: req.query.magasin,
      service: req.query.service
    };
    
    const cases = await dataManager.getAllCases(filters);
    
    res.json({
      success: true,
      data: cases,
      count: cases.length
    });
  } catch (error) {
    console.error("Erreur GET /api/cases:", error);
    res.status(500).json({
      success: false,
      error: "Erreur lors de la récupération des dossiers"
    });
  }
});

// GET /api/cases/:no - Récupérer un dossier spécifique
router.get("/api/cases/:no", async (req, res) => {
  try {
    const caseNo = req.params.no;
    const caseData = await dataManager.getCaseByNo(caseNo);
    
    res.json({
      success: true,
      data: caseData
    });
  } catch (error) {
    console.error(`Erreur GET /api/cases/${req.params.no}:`, error);
    
    if (error.message.includes("introuvable")) {
      res.status(404).json({
        success: false,
        error: `Dossier ${req.params.no} introuvable`
      });
    } else {
      res.status(500).json({
        success: false,
        error: "Erreur lors de la récupération du dossier"
      });
    }
  }
});

// POST /api/cases - Créer un nouveau dossier
router.post("/api/cases", async (req, res) => {
  try {
    const newCase = await dataManager.addCase(req.body);
    
    res.status(201).json({
      success: true,
      data: newCase
    });
  } catch (error) {
    console.error("Erreur POST /api/cases:", error);
    res.status(500).json({
      success: false,
      error: "Erreur lors de la création du dossier"
    });
  }
});

// POST /api/cases/:no/status - Mettre à jour le statut d'un dossier
router.post("/api/cases/:no/status", async (req, res) => {
  try {
    const caseNo = req.params.no;
    const { status, estimation } = req.body;
    
    const updates = {
      status,
      ...(estimation !== undefined && { estimation })
    };
    
    const updatedCase = await dataManager.updateCase(caseNo, updates);
    
    res.json({
      success: true,
      data: updatedCase
    });
  } catch (error) {
    console.error(`Erreur POST /api/cases/${req.params.no}/status:`, error);
    
    if (error.message.includes("introuvable")) {
      res.status(404).json({
        success: false,
        error: `Dossier ${req.params.no} introuvable`
      });
    } else {
      res.status(500).json({
        success: false,
        error: "Erreur lors de la mise à jour du statut"
      });
    }
  }
});

// PUT /api/cases/:no - Mettre à jour un dossier complet
router.put("/api/cases/:no", async (req, res) => {
  try {
    const caseNo = req.params.no;
    const updatedCase = await dataManager.updateCase(caseNo, req.body);
    
    res.json({
      success: true,
      data: updatedCase
    });
  } catch (error) {
    console.error(`Erreur PUT /api/cases/${req.params.no}:`, error);
    
    if (error.message.includes("introuvable")) {
      res.status(404).json({
        success: false,
        error: `Dossier ${req.params.no} introuvable`
      });
    } else {
      res.status(500).json({
        success: false,
        error: "Erreur lors de la mise à jour du dossier"
      });
    }
  }
});

// GET /api/lignes - Récupérer toutes les lignes actives
router.get("/api/lignes", async (req, res) => {
  try {
    const lignes = await dataManager.getLignes();
    
    res.json({
      success: true,
      data: lignes,
      count: lignes.length
    });
  } catch (error) {
    console.error("Erreur GET /api/lignes:", error);
    res.status(500).json({
      success: false,
      error: "Erreur lors de la récupération des lignes"
    });
  }
});

// GET /api/regles - Récupérer les règles de référence (avec filtres)
router.get("/api/regles", async (req, res) => {
  try {
    const filters = {
      service: req.query.service,
      cylindres: req.query.cylindres ? parseInt(req.query.cylindres) : undefined,
      carburant: req.query.carburant
    };
    
    const regles = await dataManager.getReglesRef(filters);
    
    res.json({
      success: true,
      data: regles,
      count: regles.length
    });
  } catch (error) {
    console.error("Erreur GET /api/regles:", error);
    res.status(500).json({
      success: false,
      error: "Erreur lors de la récupération des règles"
    });
  }
});

// POST /api/cache/clear - Vider le cache (utile après mise à jour manuelle du JSON)
router.post("/api/cache/clear", (req, res) => {
  try {
    dataManager.clearCache();
    res.json({
      success: true,
      message: "Cache vidé"
    });
  } catch (error) {
    console.error("Erreur POST /api/cache/clear:", error);
    res.status(500).json({
      success: false,
      error: "Erreur lors du vidage du cache"
    });
  }
});

// GET /api/health - Vérifier la santé de l'API et la connexion FTP
router.get("/api/health", async (req, res) => {
  try {
    await dataManager.getData(false); // Test de connexion
    res.json({
      success: true,
      status: "healthy",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      status: "unhealthy",
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

export default router;
