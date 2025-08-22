import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import formtelevente from './formtelevente/index.js';
import formulairePiece from './formulaire-piece/index.js';
import formulairePiecePL from './formulaire-piecepl/index.js';
import formulairePneu from './formulaire-pneu/index.js';
import suiviDossier from './suivi-dossier/index.js';

import loansRouter from './pretvehiculed/server-loans.js';

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.set('trust proxy', 1);

app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

app.use('/formtelevente', formtelevente);
app.use('/formulaire-piece', formulairePiece);
app.use('/formulaire-piecepl', formulairePiecePL);
app.use('/formulaire-pneu', formulairePneu);
app.use('/suivi-dossier', suiviDossier);

const pretPublic = path.join(__dirname, 'pretvehiculed', 'public');
app.use('/pret', express.static(pretPublic));

app.get('/pret/fiche', (_req, res) => {
  res.sendFile(path.join(pretPublic, 'fiche-pret.html'));
});

app.get('/pret/admin', (_req, res) => {
  res.sendFile(path.join(pretPublic, 'admin-parc.html'));
});

app.use('/pret/api', loansRouter);

app.get('/healthz', (_req, res) => res.sendStatus(200));

app.get('/', (_req, res) => {
  res.send('📝 Mes Formulaires – service opérationnel');
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
