# Projet mes-formulaires

## Objectif
Service web Node/Express qui regroupe plusieurs formulaires (VL/PL/pneu, televente, atelier, presences, pret vehicule, ramasse) et expose des API utilitaires. Le contenu statique HTML/CSS/JS est servi depuis /public et des sous-dossiers de modules.

## Architecture
- Monolithe Express (server.js) avec routers par fonctionnalite.
- Stockage par fichiers locaux + FTP et Apps Script (Google) pour certaines integrations.
- Envoi d'emails via Nodemailer avec file de jobs locale.

## Tech stack
- Node.js >=20, Express 4
- JavaScript (ESM)
- Libs principales: axios, multer, nodemailer, pdfkit, pdf-lib, basic-ftp, exceljs, qrcode

## Structure du depot (high level)
- server.js: point d'entree HTTP
- routes/: APIs presences, ramasse, kilometrage, mail-logs
- formtelevente/, formulaire-piece/, formulaire-piecepl/, formulaire-pneu/: routers et envois d'emails
- atelier/, suivi-dossier/, pretvehiculed/: pages + API
- public/: pages et assets publics
- assets/: images
- mailQueue.js/mailInlineWorker.js: file d'envoi email
