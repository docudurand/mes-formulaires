// Test minimal pour vérifier que le module garantie se charge
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Simuler les variables d'environnement minimales
process.env.FTP_HOST = 'test';
process.env.FTP_USER = 'test';
process.env.FTP_PASS = 'test';
process.env.GARANTIE_FTP_BACKUP_FOLDER = '/test';
process.env.SMTP_HOST = 'test';
process.env.SMTP_USER = 'test';
process.env.SMTP_PASS = 'test';
process.env.FROM_EMAIL = 'test@test.com';
process.env.MAGASIN_MAILS_JSON = '{}';
process.env.FOURNISSEUR_MAILS_JSON = '{}';

console.log('🔍 Test de chargement du module garantie...\n');

try {
    // Tenter d'importer le module
    const garantieRouter = await import('./garantie-module/routes.js');
    console.log('✅ Module garantie importé avec succès!');
    console.log('   Type:', typeof garantieRouter.default);
    console.log('   Est un routeur Express:', typeof garantieRouter.default === 'function');
    
    // Monter le module
    app.use('/api/garantie', garantieRouter.default);
    console.log('✅ Module monté sur /api/garantie');
    
    // Servir les fichiers statiques
    app.use('/garantie', express.static(path.join(__dirname, 'garantie')));
    console.log('✅ Fichiers statiques /garantie configurés');
    
    // Démarrer le serveur
    app.listen(PORT, () => {
        console.log(`\n✅ Serveur de test démarré sur http://localhost:${PORT}`);
        console.log('\n📋 URLs à tester:');
        console.log(`   - http://localhost:${PORT}/api/garantie/admin`);
        console.log(`   - http://localhost:${PORT}/garantie/demande.html`);
        console.log('\n⚠️  Appuyez sur Ctrl+C pour arrêter\n');
    });
    
} catch (error) {
    console.error('❌ ERREUR lors du chargement du module:');
    console.error('   Message:', error.message);
    console.error('   Stack:', error.stack);
    process.exit(1);
}
