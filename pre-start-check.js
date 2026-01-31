// Script de vérification pré-démarrage
// À exécuter AVANT de démarrer le serveur pour détecter les problèmes

console.log('\n' + '='.repeat(70));
console.log('🔍 VÉRIFICATION PRÉ-DÉMARRAGE - MODULE GARANTIE');
console.log('='.repeat(70) + '\n');

let errorsFound = 0;
let warningsFound = 0;

// 1. Vérifier les fichiers critiques
console.log('1️⃣  Fichiers critiques');
console.log('-'.repeat(70));

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const criticalFiles = [
    'garantie-module/routes.js',
    'garantie/admin-garantie.html',
    'garantie/demande.html',
    'gestion-garantie.html',
    'mailer.js',
    'server.js'
];

criticalFiles.forEach(file => {
    const fullPath = path.join(__dirname, file);
    if (fs.existsSync(fullPath)) {
        const size = fs.statSync(fullPath).size;
        console.log(`   ✅ ${file} (${(size/1024).toFixed(2)} KB)`);
    } else {
        console.log(`   ❌ ${file} MANQUANT!`);
        errorsFound++;
    }
});

// 2. Vérifier les variables d'environnement
console.log('\n2️⃣  Variables d'environnement critiques');
console.log('-'.repeat(70));

const criticalEnvVars = [
    { name: 'GARANTIE_FTP_BACKUP_FOLDER', required: true },
    { name: 'FTP_HOST', required: true },
    { name: 'FTP_USER', required: true },
    { name: 'FTP_PASS', required: true, hide: true },
    { name: 'SMTP_HOST', required: true },
    { name: 'SMTP_USER', required: true },
    { name: 'SMTP_PASS', required: true, hide: true },
    { name: 'FROM_EMAIL', required: true },
    { name: 'MAGASIN_MAILS_JSON', required: true },
    { name: 'FOURNISSEUR_MAILS_JSON', required: true }
];

criticalEnvVars.forEach(env => {
    const value = process.env[env.name];
    if (value) {
        const display = env.hide ? '***' : (value.length > 40 ? value.substring(0, 40) + '...' : value);
        console.log(`   ✅ ${env.name} = ${display}`);
    } else {
        if (env.required) {
            console.log(`   ❌ ${env.name} MANQUANTE!`);
            errorsFound++;
        } else {
            console.log(`   ⚠️  ${env.name} manquante (optionnelle)`);
            warningsFound++;
        }
    }
});

// 3. Vérifier la syntaxe des JSON
console.log('\n3️⃣  Validation JSON');
console.log('-'.repeat(70));

function parseEnvJsonObject(varName) {
    const raw0 = (process.env[varName] || '').trim();
    if (!raw0) return null;
    let raw = raw0;
    const first = raw[0];
    const last = raw[raw.length - 1];
    if ((first === "'" || first === '"' || first === "`") && last === first) {
        raw = raw.slice(1, -1).trim();
    }
    try {
        const obj = JSON.parse(raw);
        return obj;
    } catch (e) {
        return { error: e.message };
    }
}

const magasinMails = parseEnvJsonObject('MAGASIN_MAILS_JSON');
if (magasinMails && !magasinMails.error) {
    console.log(`   ✅ MAGASIN_MAILS_JSON valide (${Object.keys(magasinMails).length} magasins)`);
} else if (magasinMails && magasinMails.error) {
    console.log(`   ❌ MAGASIN_MAILS_JSON invalide: ${magasinMails.error}`);
    errorsFound++;
} else {
    console.log(`   ❌ MAGASIN_MAILS_JSON manquant`);
    errorsFound++;
}

const fournisseurMails = parseEnvJsonObject('FOURNISSEUR_MAILS_JSON');
if (fournisseurMails && !fournisseurMails.error) {
    console.log(`   ✅ FOURNISSEUR_MAILS_JSON valide (${Object.keys(fournisseurMails).length} fournisseurs)`);
} else if (fournisseurMails && fournisseurMails.error) {
    console.log(`   ❌ FOURNISSEUR_MAILS_JSON invalide: ${fournisseurMails.error}`);
    errorsFound++;
} else {
    console.log(`   ❌ FOURNISSEUR_MAILS_JSON manquant`);
    errorsFound++;
}

// 4. Tester l'import du module
console.log('\n4️⃣  Test d\'import du module garantie');
console.log('-'.repeat(70));

try {
    const garantieRouter = await import('./garantie-module/routes.js');
    if (garantieRouter.default && typeof garantieRouter.default === 'function') {
        console.log('   ✅ Module garantie importé avec succès');
        console.log('   ✅ Export default est un routeur Express valide');
    } else {
        console.log('   ❌ Export default invalide');
        errorsFound++;
    }
} catch (error) {
    console.log(`   ❌ Erreur d'import: ${error.message}`);
    errorsFound++;
}

// Résumé
console.log('\n' + '='.repeat(70));
if (errorsFound === 0 && warningsFound === 0) {
    console.log('✅ TOUS LES TESTS RÉUSSIS - LE SERVEUR PEUT DÉMARRER');
    console.log('='.repeat(70) + '\n');
    process.exit(0);
} else if (errorsFound === 0) {
    console.log(`⚠️  ${warningsFound} AVERTISSEMENT(S) - Le serveur peut démarrer`);
    console.log('='.repeat(70) + '\n');
    process.exit(0);
} else {
    console.log(`❌ ${errorsFound} ERREUR(S) CRITIQUE(S) TROUVÉE(S)`);
    console.log('   LE SERVEUR NE PEUT PAS DÉMARRER CORRECTEMENT');
    console.log('\n📋 Actions requises:');
    console.log('   1. Corriger les erreurs ci-dessus');
    console.log('   2. Vérifier les variables d\'environnement sur Render');
    console.log('   3. Relancer le déploiement');
    console.log('='.repeat(70) + '\n');
    process.exit(1);
}
