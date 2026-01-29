// API REST pour la gestion des prêts de véhicules avec stockage FTP JSON
// Ce module gère toutes les opérations CRUD sur les véhicules, magasins et prêts

import express from 'express';
import * as ftpStorage from './ftp-loans-storage.js';

const router = express.Router();

// GET /pret/api/vehicles - Liste tous les véhicules
router.get('/api/vehicles', async (req, res) => {
  try {
    const result = await ftpStorage.listVehicles();
    res.json(result);
  } catch (error) {
    console.error('[GET /api/vehicles] Erreur:', error);
    res.status(500).json({
      ok: false,
      error: error.message,
      vehicles: []
    });
  }
});

// PUT /pret/api/vehicles/:vehicleId - Mettre à jour un véhicule
router.put('/api/vehicles/:vehicleId', async (req, res) => {
  try {
    const { vehicleId } = req.params;
    const updates = req.body;
    
    console.log(`[PUT /api/vehicles/${vehicleId}] Mise à jour véhicule`, updates);
    
    // Lire les données actuelles via la fonction interne (on va l'ajouter)
    const data = await ftpStorage.readLoansData();
    
    // Trouver l'index du véhicule
    const vehicleIndex = data.vehicles.findIndex(v => v.vehicle_id === vehicleId);
    
    if (vehicleIndex === -1) {
      return res.status(404).json({
        ok: false,
        error: 'Véhicule non trouvé'
      });
    }
    
    // Mettre à jour les champs
    const vehicle = data.vehicles[vehicleIndex];
    
    if (updates.immatriculation !== undefined) vehicle.immatriculation = updates.immatriculation;
    if (updates.marque !== undefined) vehicle.marque = updates.marque;
    if (updates.modele !== undefined) vehicle.modele = updates.modele;
    if (updates.magasin_home !== undefined) vehicle.magasin_home = updates.magasin_home;
    if (updates.ct !== undefined) vehicle.ct = updates.ct;
    if (updates.pollution !== undefined) vehicle.pollution = updates.pollution;
    if (updates.disponible !== undefined) vehicle.disponible = updates.disponible;
    
    vehicle.updated_at = new Date().toISOString();
    
    // Sauvegarder
    await ftpStorage.writeLoansData(data);
    
    console.log(`[PUT /api/vehicles/${vehicleId}] ✅ Véhicule mis à jour`);
    
    res.json({
      ok: true,
      vehicle
    });
    
  } catch (error) {
    console.error('[PUT /api/vehicles/:vehicleId] Erreur:', error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// GET /pret/api/stores - Liste tous les magasins
router.get('/api/stores', async (req, res) => {
  try {
    const result = await ftpStorage.listStores();
    res.json(result);
  } catch (error) {
    console.error('[GET /api/stores] Erreur:', error);
    res.status(500).json({
      ok: false,
      error: error.message,
      stores: []
    });
  }
});

// GET /pret/api/loans/search - Recherche de prêts
router.get('/api/loans/search', async (req, res) => {
  try {
    const { immat = '', date = '' } = req.query;
    const loans = await ftpStorage.searchLoans(immat, date);
    res.json(loans);
  } catch (error) {
    console.error('[GET /api/loans/search] Erreur:', error);
    res.status(500).json([]);
  }
});

// POST /pret/api/loans - Créer un nouveau prêt
router.post('/api/loans', async (req, res) => {
  try {
    console.log('[POST /api/loans] Création prêt:', req.body);
    const result = await ftpStorage.createLoan(req.body);
    
    if (result.ok) {
      console.log('[POST /api/loans] ✅ Prêt créé:', result.loan_id);
    } else {
      console.error('[POST /api/loans] ❌ Échec:', result.error);
    }
    
    res.json(result);
  } catch (error) {
    console.error('[POST /api/loans] Erreur:', error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// PUT /pret/api/loans/:loanId - Mettre à jour un prêt
router.put('/api/loans/:loanId', async (req, res) => {
  try {
    const { loanId } = req.params;
    console.log(`[PUT /api/loans/${loanId}] Mise à jour:`, req.body);
    
    const result = await ftpStorage.updateLoan(loanId, req.body);
    
    if (result.ok) {
      console.log(`[PUT /api/loans/${loanId}] ✅ Prêt mis à jour`);
    }
    
    res.json(result);
  } catch (error) {
    console.error(`[PUT /api/loans/${loanId}] Erreur:`, error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// POST /pret/api/loans/:loanId/close - Clôturer un prêt
router.post('/api/loans/:loanId/close', async (req, res) => {
  try {
    const { loanId } = req.params;
    console.log(`[POST /api/loans/${loanId}/close] Clôture:`, req.body);
    
    const result = await ftpStorage.closeLoan(loanId, req.body);
    
    if (result.ok) {
      console.log(`[POST /api/loans/${loanId}/close] ✅ Prêt clôturé`);
    }
    
    res.json(result);
  } catch (error) {
    console.error(`[POST /api/loans/${loanId}/close] Erreur:`, error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// GET /pret/api/health - Health check
router.get('/api/health', (req, res) => {
  const ftpCheck = ftpStorage.checkFtpConfig();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    ftp: ftpCheck
  });
});

export default router;
