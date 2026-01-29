// Script de migration : Excel → JSON sur FTP
// À exécuter UNE SEULE FOIS pour migrer les données existantes

import ExcelJS from 'exceljs';
import * as ftpStorage from './ftp-loans-storage.js';
import fs from 'fs';
import path from 'path';

/**
 * Parse une date Excel (nombre de jours depuis 1900)
 */
function parseExcelDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number') {
    const msPerDay = 86400000;
    const excelEpoch = new Date(1899, 11, 30).getTime();
    return new Date(excelEpoch + value * msPerDay);
  }
  if (typeof value === 'string') {
    const date = new Date(value);
    return isNaN(date) ? null : date;
  }
  return null;
}

/**
 * Formate une date au format ISO
 */
function formatDate(date) {
  if (!date) return '';
  const d = parseExcelDate(date);
  if (!d) return '';
  return d.toISOString().split('T')[0];
}

/**
 * Formate une heure au format HH:MM
 */
function formatTime(value) {
  if (!value) return '';
  
  if (typeof value === 'string' && /^\d{1,2}:\d{2}/.test(value)) {
    return value.slice(0, 5);
  }
  
  const date = parseExcelDate(value);
  if (date) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }
  
  return '';
}

/**
 * Lit le fichier Excel et extrait les données
 */
async function readExcelFile(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  
  const worksheet = workbook.worksheets[0]; // Première feuille
  
  const vehicles = new Map();
  const stores = new Set();
  const loans = [];
  
  // Lire les en-têtes (première ligne)
  const headers = [];
  const headerRow = worksheet.getRow(1);
  headerRow.eachCell((cell, colNumber) => {
    headers[colNumber] = String(cell.value || '').trim().toLowerCase();
  });
  
  console.log('En-têtes détectés:', headers);
  
  // Lire les données (à partir de la ligne 2)
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // Ignorer l'en-tête
    
    const rowData = {};
    row.eachCell((cell, colNumber) => {
      const header = headers[colNumber];
      if (header) {
        rowData[header] = cell.value;
      }
    });
    
    // Extraire les informations du véhicule
    const vehicleId = rowData['vehicle_id'] || rowData['id_vehicule'] || '';
    const immat = rowData['immatriculation'] || rowData['immat'] || '';
    
    if (vehicleId && immat) {
      vehicles.set(vehicleId, {
        vehicle_id: String(vehicleId),
        immatriculation: String(immat),
        marque: String(rowData['marque'] || ''),
        modele: String(rowData['modele'] || rowData['model'] || ''),
        disponible: true
      });
    }
    
    // Extraire le magasin
    const magasin = rowData['magasin'] || rowData['magasin_pret'] || '';
    if (magasin) {
      stores.add(String(magasin));
    }
    
    // Créer l'entrée de prêt si elle existe
    const dateDepart = rowData['date_depart'] || rowData['date_début'] || '';
    if (dateDepart) {
      const loanId = `LOAN_MIGRATED_${rowNumber}_${Date.now()}`;
      
      const loan = {
        loan_id: loanId,
        vehicle_id: String(vehicleId || ''),
        immatriculation: String(immat || ''),
        magasin_pret: String(magasin || ''),
        chauffeur_nom: String(rowData['chauffeur'] || rowData['chauffeur_nom'] || ''),
        transfert_assurance: String(rowData['transfert_assurance'] || rowData['assurance'] || ''),
        date_depart: formatDate(dateDepart),
        heure_depart: formatTime(rowData['heure_depart'] || rowData['heure_début'] || ''),
        date_retour: formatDate(rowData['date_retour'] || rowData['date_fin'] || ''),
        heure_retour: formatTime(rowData['heure_retour'] || rowData['heure_fin'] || ''),
        receptionnaire_depart: String(rowData['receptionnaire_depart'] || rowData['réceptionnaire'] || ''),
        receptionnaire_retour: String(rowData['receptionnaire_retour'] || ''),
        observations: String(rowData['observations'] || rowData['information'] || rowData['info_chauffeur'] || ''),
        status: rowData['statut'] || rowData['status'] || 'en cours',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      
      // Déterminer le statut en fonction de la date de retour
      if (loan.date_retour) {
        loan.status = 'clôturé';
        loan.closed_at = new Date(loan.date_retour).toISOString();
      }
      
      loans.push(loan);
    }
  });
  
  return {
    vehicles: Array.from(vehicles.values()),
    stores: Array.from(stores).map(name => ({ name })),
    loans
  };
}

/**
 * Migration principale
 */
async function migrate(excelFilePath) {
  console.log('\n========================================');
  console.log('MIGRATION EXCEL → FTP JSON');
  console.log('========================================\n');
  
  try {
    // Vérifier que le fichier existe
    if (!fs.existsSync(excelFilePath)) {
      throw new Error(`Fichier non trouvé: ${excelFilePath}`);
    }
    
    console.log(`📁 Lecture du fichier Excel: ${excelFilePath}`);
    const data = await readExcelFile(excelFilePath);
    
    console.log(`\n✅ Données extraites:`);
    console.log(`   - ${data.vehicles.length} véhicules`);
    console.log(`   - ${data.stores.length} magasins`);
    console.log(`   - ${data.loans.length} prêts`);
    
    // Afficher quelques exemples
    if (data.vehicles.length > 0) {
      console.log(`\n📋 Exemple de véhicule:`);
      console.log(JSON.stringify(data.vehicles[0], null, 2));
    }
    
    if (data.loans.length > 0) {
      console.log(`\n📋 Exemple de prêt:`);
      console.log(JSON.stringify(data.loans[0], null, 2));
    }
    
    console.log(`\n⬆️  Upload vers FTP...`);
    
    // Écrire sur le FTP
    const ftpResult = await ftpStorage.writeLoansData({
      vehicles: data.vehicles,
      stores: data.stores,
      loans: data.loans,
      lastUpdate: new Date().toISOString(),
      migrated_at: new Date().toISOString(),
      source: 'excel_migration'
    });
    
    if (ftpResult) {
      console.log(`\n✅ Migration réussie !`);
      console.log(`   - Fichier créé sur le FTP`);
      console.log(`   - ${data.vehicles.length} véhicules migrés`);
      console.log(`   - ${data.stores.length} magasins migrés`);
      console.log(`   - ${data.loans.length} prêts migrés`);
    }
    
  } catch (error) {
    console.error(`\n❌ Erreur lors de la migration:`);
    console.error(error.message);
    throw error;
  }
}

// Exécution si appelé directement
if (import.meta.url === `file://${process.argv[1]}`) {
  const excelPath = process.argv[2] || './pret_vehicule.xlsx';
  
  migrate(excelPath)
    .then(() => {
      console.log('\n✅ Migration terminée avec succès\n');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Échec de la migration\n');
      process.exit(1);
    });
}

export { migrate, readExcelFile };
