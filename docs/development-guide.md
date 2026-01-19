# Development Guide

## Prerequis
- Node.js >= 20
- npm

## Installation
```bash
npm install
```

## Lancer le serveur
```bash
npm run dev
# ou
npm start
```

## Worker mail
Le worker consomme la file locale des emails.
```bash
node mailInlineWorker.js
```

## Dossiers de travail locaux
- mail-queue/ : jobs email
- data/ : visites (visits.json)
- tmp/ : pieces temporaires
- compteurs.json : stats formulaires

## Variables d'environnement (principales)
- PORT
- SMTP_USER / FROM_EMAIL / MAIL_TO / MAIL_CG
- FTP_HOST / FTP_USER / FTP_PASSWORD / FTP_PORT / FTP_SECURE / FTP_TLS_REJECT_UNAUTH
- APPSCRIPT_URL / APPSCRIPT_KEY
- GS_ATELIER_URL / GS_ATELIER_SHEET
- GS_KILOMETRAGE_URL
- GS_MAIL_LOG_URL
- PRESENCES_LEAVES_PASSWORD
- RAMASSE_SECRET

Voir aussi: server.js, routes/, form modules pour la liste complete.
