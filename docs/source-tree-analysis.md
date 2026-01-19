# Source Tree Analysis

## Arborescence (niveau 1-2)

project-root/
  _bmad/
  _bmad-output/
  assets/
  atelier/
    public/
  commerce/
  docatelier/
  formtelevente/
  formulaire-piece/
  formulaire-piecepl/
  formulaire-pneu/
  garantie/
  pl/
  presences/
  pretvehiculed/
    public/
  public/
  routes/
  suivi-dossier/
    public/
  utilitaire/
  vl/
  admin.html
  commerce.html
  gestion-garantie.html
  index.html
  login.html
  server.js
  index.js
  style.css
  compteur.js
  stats.js
  visits.js
  mailer.js
  mailQueue.js
  mailInlineWorker.js
  mailLog.js
  package.json
  Dockerfile

## Dossiers cles
- routes/: endpoints API (presences, ramasse, kilometrage, mail-logs)
- formtelevente/, formulaire-*/: formulaires + logique email
- atelier/: workflow atelier (pages + API)
- suivi-dossier/: pages de suivi dossier
- pretvehiculed/: pret vehicule (pages + API)
- public/: pages statiques publiques
- assets/: images et ressources

## Points d'entree
- server.js: serveur principal
- mailInlineWorker.js: worker de file email
