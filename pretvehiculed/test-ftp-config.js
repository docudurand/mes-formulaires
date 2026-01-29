#!/usr/bin/env node
// Script de test pour vérifier la configuration FTP et les opérations

import dotenv from 'dotenv';
import * as ftpStorage from './ftp-loans-storage.js';
import { readExcelFile } from './migrate-excel-to-ftp.js';
import chalk from 'chalk'; // Pour les couleurs dans le terminal

// Charger les variables d'environnement
dotenv.config();

console.log('\n' + '='.repeat(60));
console.log('🧪 TEST DE CONFIGURATION FTP - PRÊTS VÉHICULES');
console.log('='.repeat(60) + '\n');

// Fonction utilitaire pour afficher les résultats
function logTest(name, passed, details = '') {
  const icon = passed ? '✅' : '❌';
  const status = passed ? 'PASS' : 'FAIL';
  console.log(`${icon} ${name}: ${status}`);
  if (details) console.log(`   ${details}\n`);
}

async function runTests() {
  let allPassed = true;

  // Test 1: Vérification des variables d'environnement
  console.log('📋 Test 1: Variables d\'environnement\n');
  
  const requiredVars = ['FTP_HOST', 'FTP_USER', 'FTP_PASSWORD'];
  const optionalVars = ['FTP_PORT', 'FTP_SECURE', 'FTP_BACKUP_FOLDER'];
  
  for (const varName of requiredVars) {
    const value = process.env[varName];
    const passed = !!value;
    logTest(
      `Variable ${varName}`,
      passed,
      passed ? `Valeur: ${varName === 'FTP_PASSWORD' ? '***' : value}` : 'MANQUANTE'
    );
    if (!passed) allPassed = false;
  }
  
  for (const varName of optionalVars) {
    const value = process.env[varName];
    logTest(
      `Variable ${varName} (optionnelle)`,
      true,
      value ? `Valeur: ${value}` : 'Non définie (valeur par défaut utilisée)'
    );
  }

  // Test 2: Vérification de la configuration FTP
  console.log('\n📋 Test 2: Configuration FTP\n');
  
  const ftpCheck = ftpStorage.checkFtpConfig();
  logTest('Configuration FTP', ftpCheck.ok, ftpCheck.error || 'Configuration valide');
  
  if (!ftpCheck.ok) {
    allPassed = false;
    console.log('\n❌ Tests arrêtés: configuration FTP invalide\n');
    return false;
  }

  // Test 3: Test de lecture (le fichier peut ne pas exister)
  console.log('\n📋 Test 3: Lecture du fichier JSON\n');
  
  try {
    const vehicles = await ftpStorage.listVehicles();
    logTest(
      'Lecture des véhicules',
      true,
      `${vehicles.vehicles?.length || 0} véhicules trouvés`
    );
  } catch (error) {
    logTest('Lecture des véhicules', false, error.message);
    allPassed = false;
  }

  // Test 4: Test d'écriture (création d'un prêt de test)
  console.log('\n📋 Test 4: Écriture sur le FTP\n');
  
  try {
    const testLoan = {
      vehicle_id: 'TEST_' + Date.now(),
      immatriculation: 'TEST-999-ZZ',
      magasin_pret: 'Test Magasin',
      chauffeur_nom: 'Test Driver',
      date_depart: new Date().toISOString().split('T')[0],
      heure_depart: '10:00',
      observations: 'Ceci est un test automatique'
    };
    
    const result = await ftpStorage.createLoan(testLoan);
    
    if (result.ok) {
      logTest('Création d\'un prêt de test', true, `ID créé: ${result.loan_id}`);
      
      // Test 5: Recherche du prêt qu'on vient de créer
      console.log('\n📋 Test 5: Recherche du prêt créé\n');
      
      const searchResults = await ftpStorage.searchLoans('TEST-999-ZZ');
      const found = searchResults.length > 0;
      logTest('Recherche du prêt de test', found, found ? `${searchResults.length} résultat(s) trouvé(s)` : 'Prêt non trouvé');
      
      if (!found) allPassed = false;
      
      // Test 6: Clôture du prêt de test
      if (found && result.loan_id) {
        console.log('\n📋 Test 6: Clôture du prêt de test\n');
        
        const closeResult = await ftpStorage.closeLoan(result.loan_id, {
          date_retour: new Date().toISOString().split('T')[0],
          heure_retour: '18:00',
          receptionnaire_retour: 'Test Receptionist'
        });
        
        logTest('Clôture du prêt', closeResult.ok, closeResult.error || 'Prêt clôturé avec succès');
        if (!closeResult.ok) allPassed = false;
      }
    } else {
      logTest('Création d\'un prêt de test', false, result.error);
      allPassed = false;
    }
  } catch (error) {
    logTest('Création d\'un prêt de test', false, error.message);
    allPassed = false;
  }

  // Test 7: Vérification finale
  console.log('\n📋 Test 7: Vérification des données\n');
  
  try {
    const vehicles = await ftpStorage.listVehicles();
    const stores = await ftpStorage.listStores();
    const allLoans = await ftpStorage.searchLoans();
    
    console.log('📊 Statistiques actuelles:');
    console.log(`   - Véhicules: ${vehicles.vehicles?.length || 0}`);
    console.log(`   - Magasins: ${stores.stores?.length || 0}`);
    console.log(`   - Prêts totaux: ${allLoans.length}`);
    console.log(`   - Prêts en cours: ${allLoans.filter(l => l.status === 'en cours').length}`);
    console.log(`   - Prêts clôturés: ${allLoans.filter(l => l.status.toLowerCase().includes('clôt')).length}\n`);
    
    logTest('Récupération des statistiques', true, 'Données récupérées avec succès');
  } catch (error) {
    logTest('Récupération des statistiques', false, error.message);
    allPassed = false;
  }

  return allPassed;
}

// Exécution des tests
runTests()
  .then(success => {
    console.log('\n' + '='.repeat(60));
    if (success) {
      console.log('✅ TOUS LES TESTS SONT PASSÉS !');
      console.log('='.repeat(60) + '\n');
      console.log('🎉 Votre configuration FTP est opérationnelle !');
      console.log('👉 Vous pouvez maintenant migrer vos données avec:');
      console.log('   node migrate-excel-to-ftp.js ./pret_vehicule.xlsx\n');
      process.exit(0);
    } else {
      console.log('❌ CERTAINS TESTS ONT ÉCHOUÉ');
      console.log('='.repeat(60) + '\n');
      console.log('⚠️  Vérifiez les erreurs ci-dessus et corrigez la configuration.');
      console.log('📖 Consultez MIGRATION_GUIDE.md pour plus d\'aide.\n');
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('\n❌ ERREUR CRITIQUE:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  });
