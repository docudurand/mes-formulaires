import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import formtelevente from './formtelevente/index.js';
import formulairePiece from './formulaire-piece/index.js';
import formulairePiecePL from './formulaire-piecepl/index.js';
import formulairePneu from './formulaire-pneu/index.js';

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({ limit: '15mb' }));

app.use('/formtelevente', formtelevente);
app.use('/formulaire-piece', formulairePiece);
app.use('/formulaire-piecepl', formulairePiecePL);
app.use('/formulaire-pneu', formulairePneu);

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
  
  const server = app.listen(PORT, () => {
  console.log(`Serveur lancé sur ${PORT}`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM reçu, fermeture du serveur…');
  server.close(() => process.exit(0));
});

