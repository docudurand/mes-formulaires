# API Contracts

Base: serveur Express dans server.js. Toutes les routes repondent en JSON ou HTML selon endpoint.

## Health
- GET /healthz
  - 200 OK

## Auth simple
- POST /api/site/login
  - Body: { password }
  - 200 OK si valide, 401 sinon

## Presences (router /presence)
- GET /presence/personnel?magasin=...
- GET /presence/employes?magasin=...
- POST /presence/save
  - Body: { magasin, date (YYYY-MM-DD), data }
- GET /presence/day?magasin=...&date=YYYY-MM-DD
- GET /presence/month-store?yyyymm=YYYY-MM&magasin=...
- GET /presence/leaves
  - Header: X-Admin-Token requis
- POST /presence/leaves/decision
  - Header: X-Admin-Token requis
  - Body: { id, decision: accept|reject|cancel, reason? }
- POST /presence/range-mark
  - Header: X-Admin-Token requis
  - Body: { magasin, nom, prenom, code, dateDu, dateAu, slots? }

## Export presences
- GET /presence/export-month?yyyymm=YYYY-MM&magasin=...
  - Header: X-Admin-Token (PRESENCES_LEAVES_PASSWORD)
  - Retourne un fichier XLSX

## Kilometrage (router /api/kilometrage)
- POST /api/kilometrage/save
- POST /api/kilometrage/newid
- POST /api/kilometrage/absent
- GET /api/kilometrage/params?agence=...
- GET /api/kilometrage/data?agence=...&year=...
- GET /api/kilometrage/resume?agence=...&date=YYYY-MM-DD

## Ramasse (router /api/ramasse)
- GET /api/ramasse/fournisseurs
- GET /api/ramasse/magasins
- GET /api/ramasse/stats
- POST /api/ramasse/ (multipart)
  - Champs: fournisseur, email, pieces, magasin?, commentaire?, magasinDest?, demandeurNomPrenom?
- GET /api/ramasse/ack (HTML)
- POST /api/ramasse/ack (form POST)

## Televente
- GET /api/sheets/televente-lub
- GET /api/sheets/televente-bosch
- POST /formtelevente/send-order
  - Body: { client, salesperson, pdf (base64), form_origin }

## Formulaires pieces/pneu
- POST /formulaire-piece/submit-form (multipart)
- POST /formulaire-piecepl/submit-form (multipart)
- POST /formulaire-pneu/submit-form (multipart)

## Atelier
- GET /atelier/config.js
- POST /atelier/api/print-html
- POST /atelier/api/submit
- GET /atelier/api/cases
- GET /atelier/api/cases/:no
- POST /atelier/api/cases/:no/status
- GET /atelier/healthz

## Suivi dossier
- GET /suivi-dossier/config.js
- GET /suivi-dossier/healthz

## Pret vehicule (router /pret/api)
- GET /pret/api/vehicles
- GET /pret/api/stores
- GET /pret/api/loans/search?immat=...&date=...
- POST /pret/api/loans
- POST /pret/api/loans/:loan_id/update
- POST /pret/api/loans/:loan_id/close
- POST /pret/api/loans/print
- POST /pret/api/loans/email

## Autres endpoints utilitaires
- GET /stats/counters
- GET /admin/compteurs
- GET /api/util/contacts-fournisseurs
- GET /commerce/links.json
- GET /api/pl/liens-garantie-retour
- GET /api/vl/retour-garantie
- GET /api/vl/liens-formulaire-garantie

## Statique
- /public, /assets, /pl, /vl, /presences, /pret, /atelier, /suivi-dossier
