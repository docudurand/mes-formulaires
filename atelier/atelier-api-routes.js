// API Routes pour le module atelier avec données JSON/FTP
import express from "express";
import FTPDataManager from "./ftp-data-manager.js";
import emailSender from "./email-sender.js";

const router = express.Router();
const dataManager = new FTPDataManager();

// Middleware pour parser le JSON
router.use(express.json());

// POST /api/print-html - Génère la page d'aperçu d'impression
router.post("/api/print-html", (req, res) => {
  try {
    const payload = JSON.parse(req.body.payload || "{}");
    const header = payload.header || {};
    const meta = payload.meta || {};
    const commentaires = payload.commentaires || "";
    const culasse = payload.culasse || null;
    const injecteur = payload.injecteur || null;
    const no = payload.no || "";
    
    // Générer le HTML d'impression
    const html = `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>Demande ${meta.titre || "Atelier"} - ${header.client || ""}</title>
  <style>
    body { font-family: system-ui, Arial, sans-serif; padding: 20px; max-width: 800px; margin: 0 auto; }
    h1 { color: #004080; font-size: 1.5rem; margin-bottom: 20px; }
    .section { margin-bottom: 20px; }
    .section h2 { color: #004080; font-size: 1.1rem; margin-bottom: 10px; border-bottom: 2px solid #004080; padding-bottom: 5px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .field { margin-bottom: 8px; }
    .label { font-weight: 700; color: #334155; }
    .value { color: #0f172a; }
    .comment-box { border: 1px solid #e5e7eb; padding: 10px; background: #f9fafb; white-space: pre-wrap; }
    .operations { list-style: none; padding: 0; }
    .operations li { margin: 8px 0; padding-left: 20px; position: relative; }
    .operations li:before { content: "•"; position: absolute; left: 0; color: #004080; font-weight: bold; }
    .sub-item { margin-left: 20px; font-size: 0.9rem; color: #6b7280; }
    @media print {
      body { padding: 10px; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <h1>${meta.titre || "Demande Atelier"}</h1>
  
  ${no ? `<div class="section"><strong>Numéro de dossier :</strong> ${String(no).padStart(5, '0')}</div>` : ''}
  
  <div class="section">
    <h2>Informations client</h2>
    <div class="grid">
      <div class="field"><span class="label">Client :</span> <span class="value">${header.client || ""}</span></div>
      <div class="field"><span class="label">N° de compte :</span> <span class="value">${header.compte || ""}</span></div>
      <div class="field"><span class="label">Téléphone :</span> <span class="value">${header.telephone || ""}</span></div>
      <div class="field"><span class="label">Email :</span> <span class="value">${header.email || ""}</span></div>
      <div class="field"><span class="label">Magasin :</span> <span class="value">${header.magasin || ""}</span></div>
      <div class="field"><span class="label">Date demande :</span> <span class="value">${header.dateDemande || ""}</span></div>
    </div>
  </div>
  
  <div class="section">
    <h2>Véhicule</h2>
    <div class="grid">
      <div class="field"><span class="label">Véhicule :</span> <span class="value">${header.vehicule || ""}</span></div>
      <div class="field"><span class="label">Immatriculation :</span> <span class="value">${header.immat || ""}</span></div>
    </div>
  </div>
  
  <div class="section">
    <h2>Service demandé</h2>
    <div class="field"><span class="label">Service :</span> <span class="value">${header.service || ""}</span></div>
  </div>
  
  ${culasse ? `
  <div class="section">
    <h2>Détails Rectification Culasse</h2>
    <div class="grid">
      <div class="field"><span class="label">Segment :</span> <span class="value">${culasse.segment || ""}</span></div>
      <div class="field"><span class="label">Cylindres :</span> <span class="value">${culasse.cylindre || ""}</span></div>
      <div class="field"><span class="label">Soupapes :</span> <span class="value">${culasse.soupapes || ""}</span></div>
      <div class="field"><span class="label">Carburant :</span> <span class="value">${culasse.carburant || ""}</span></div>
    </div>
    
    ${culasse.operations && culasse.operations.length ? `
    <div style="margin-top: 15px;">
      <strong>Opérations à réaliser :</strong>
      <ul class="operations">
        ${culasse.operations.map(op => `
          <li>
            ${op.libelle || op.ligne}
            ${op.references && op.references.length ? `
              <div class="sub-item">
                ${op.references.map(ref => 
                  `${ref.reference || ""} ${ref.libelleRef ? "- " + ref.libelleRef : ""} ${ref.prixHT ? "(" + ref.prixHT + " € HT)" : ""}`
                ).join("<br>")}
              </div>
            ` : ''}
          </li>
        `).join('')}
      </ul>
    </div>
    ` : ''}
    
    ${culasse.piecesAFournir && culasse.piecesAFournir.length ? `
    <div style="margin-top: 15px;">
      <strong>Pièces à fournir :</strong>
      <ul class="operations">
        ${culasse.piecesAFournir.map(p => `<li>${p}</li>`).join('')}
      </ul>
    </div>
    ` : ''}
  </div>
  ` : ''}
  
  ${injecteur ? `
  <div class="section">
    <h2>Détails Contrôle injection</h2>
    <div class="grid">
      <div class="field"><span class="label">Type :</span> <span class="value">${injecteur.type || ""}</span></div>
      <div class="field"><span class="label">Nombre d'injecteurs :</span> <span class="value">${injecteur.nombre || ""}</span></div>
    </div>
  </div>
  ` : ''}
  
  ${commentaires ? `
  <div class="section">
    <h2>Commentaires</h2>
    <div class="comment-box">${commentaires}</div>
  </div>
  ` : ''}
  
  <div class="no-print" style="margin-top: 30px; text-align: center;">
    <button onclick="window.print()" style="padding: 10px 20px; background: #004080; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 1rem;">
      Imprimer
    </button>
  </div>
</body>
</html>
    `;
    
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error) {
    console.error("Erreur POST /api/print-html:", error);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Erreur</title></head>
      <body>
        <h1>Erreur lors de la génération de l'aperçu</h1>
        <p>${error.message}</p>
      </body>
      </html>
    `);
  }
});

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
    
    // Envoyer l'email de notification au responsable du service
    try {
      const emailResult = await emailSender.sendNewRequestEmail(newCase);
      if (emailResult.sent) {
        console.log(`[ATELIER] Email envoyé à ${emailResult.to} pour le dossier ${newCase.no}`);
      } else {
        console.warn(`[ATELIER] Email non envoyé pour le dossier ${newCase.no}: ${emailResult.reason}`);
      }
    } catch (emailError) {
      console.error(`[ATELIER] Erreur envoi email dossier ${newCase.no}:`, emailError);
    }
    
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
    
    // Si le statut est "Renvoyé" ou "Pièce Renvoyé", envoyer un email au client
    if (status === "Renvoyé" || status === "Pièce Renvoyé" || status === "Pièce renvoyé à l'agence") {
      try {
        const emailResult = await emailSender.sendPieceReturnedEmail(updatedCase);
        if (emailResult.sent) {
          console.log(`[ATELIER] Email de retour envoyé à ${emailResult.to} pour le dossier ${caseNo}`);
        } else {
          console.warn(`[ATELIER] Email de retour non envoyé pour le dossier ${caseNo}: ${emailResult.reason}`);
        }
      } catch (emailError) {
        console.error(`[ATELIER] Erreur envoi email de retour dossier ${caseNo}:`, emailError);
      }
    }
    
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
