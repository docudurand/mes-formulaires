# Deployment Guide

## Docker
Le depot contient un Dockerfile simple:
- base: node:20-alpine
- expose: 3000
- commande: node server.js

Build/run:
```bash
docker build -t mes-formulaires .
docker run -p 3000:3000 --env-file .env mes-formulaires
```

## Variables d'environnement
Voir docs/development-guide.md et la liste dans le code (process.env.*).

## Volumes / stockage
Prevoir des volumes pour:
- mail-queue/ (jobs email)
- data/ (visites)
- tmp/ (fichiers temporaires)
- UPLOAD_DIR (par defaut /var/data/uploads)
- compteurs.json

## Reseau / acces
- Le serveur expose des endpoints JSON et des pages HTML.
- Certains endpoints requierent un header X-Admin-Token.
