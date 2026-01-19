# Architecture

## Resume
Application monolithe Express (Node.js, ESM) qui sert des pages HTML statiques et expose des endpoints API pour la gestion de formulaires et de services internes (presences, ramasse, atelier, pret vehicule, televente). Les integrations externes passent par Apps Script et FTP. Les emails sont traites via Nodemailer, avec une file locale et un worker.

## Composants principaux
- server.js
  - Initialisation Express, middleware CORS/CSP, JSON/URL-encoded.
  - Monte les routers fonctionnels.
  - Sert les pages et assets statiques.
- routers fonctionnels
  - routes/presences.js: gestion des presences et conges (FTP + Apps Script).
  - routes/ramasse.js: demande de ramasse, generation PDF, email, FTP.
  - routes/kilometrage.js: proxy vers Apps Script (GS_KILOMETRAGE_URL).
  - routes/mail-logs.js: lecture des logs email via Apps Script.
  - formtelevente, formulaire-piece, formulaire-piecepl, formulaire-pneu: formulaires et envoi d'emails.
  - atelier: formulaire atelier + suivi via Apps Script.
  - suivi-dossier: site statique + config.
  - pretvehiculed: gestion de prets vehicules via Apps Script.
- services utilitaires
  - compteur.js / stats.js: compteurs de formulaires (local + FTP).
  - visits.js: stats visites (local + FTP).
  - mailQueue.js + mailInlineWorker.js: file de jobs email locale.
  - mailLog.js: logs email via Apps Script.

## Flux HTTP (simplifie)
Client -> Express (server.js)
  -> Router specifique (ex: /presence, /api/ramasse, /atelier)
  -> Services (FTP / Apps Script / filesystem)
  -> JSON ou HTML

## Stockage et etat
- Fichiers locaux:
  - mail-queue/ (jobs email)
  - data/visits.json
  - compteurs.json
  - tmp/ (pieces temporaires PDF/attachments)
- FTP:
  - presences (fichiers JSON par mois/magasin)
  - compteurs.json, analytics/visits.json
  - archives ramasse (PDF)

## Integrations externes
- Google Apps Script: atelier, kilometrage, pret vehicule, logs email.
- SMTP via Nodemailer.
- FTP pour sauvegardes et fichiers partages.

## Securite (niveau applicatif)
- Tokens admin via headers (X-Admin-Token) pour certaines routes.
- CSP/Frame-ancestors regles pour modules embed.
- Validations basiques sur payloads et types.

## Observations
- Plusieurs modules servent des pages HTML statiques et des endpoints JSON.
- Pas de base de donnees relationnelle; stockage base sur fichiers + FTP.
