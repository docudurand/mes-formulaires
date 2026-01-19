# Story 1.2: Servir l'UI monitor sur une route dediee

Status: done

<!-- Note: Validation optional. Run validate-create-story for quality check before dev-story. -->

## Story

En tant qu'administrateur,
je veux une page /monitor dediee,
afin de consulter les logs depuis une URL interne unique.

## Acceptance Criteria

1. Etant donne que MONITOR_ENABLED est a true et la requete est autorisee,
   quand je fais GET /monitor,
   alors le serveur renvoie la page HTML du moniteur.
2. Etant donne que la page /monitor reference monitor.css et monitor.js,
   quand le navigateur demande ces assets,
   alors les fichiers statiques sont servis correctement (avec auth).

## Tasks / Subtasks

- [x] Servir l'HTML du moniteur sur /monitor (AC: 1)
  - [x] Verifier que public/monitor.html existe et reste simple (MPA sans framework)
  - [x] S'assurer que /monitor renvoie ce fichier (sans refactor majeur)
- [x] Ajouter/mettre a jour les assets monitor.js et monitor.css (AC: 2)
  - [x] Creer public/monitor.js (stub minimal, pas de logique SSE ici)
  - [x] Creer public/monitor.css (styles de base, lisibilite)
  - [x] Referencer les assets dans public/monitor.html
- [x] Verifier que /monitor, /monitor.js et /monitor.css sont proteges par auth (AC: 1, 2)
  - [x] Confirmer que les acces sans token sont refuses
  - [x] Confirmer que les acces avec token (header ou cookie) fonctionnent

## Dev Notes

- ESM uniquement (type: module), pas de require.
- UI simple HTML/CSS/JS sans framework.
- Ne pas implementer SSE/logs ici (prevu en Epic 2/3).
- Auth obligatoire (monitorAuth) sur /monitor et les assets monitor.
- Pas de nouvelles dependances.

### Project Structure Notes

- HTML: public/monitor.html
- JS: public/monitor.js
- CSS: public/monitor.css
- Auth: monitor/auth.js (deja en place)
- Pas de refactor du module monitor/ ici (Epic 1.3)

### References

- `_bmad-output/planning-artifacts/epics.md` (Epic 1, Story 1.2)
- `_bmad-output/planning-artifacts/architecture.md` (Frontend Architecture, Project Structure)
- `_bmad-output/planning-artifacts/prd.md` (FR10)
- `_bmad-output/project-context.md` (Framework rules, Critical don't-miss rules)

## Dev Agent Record

### Agent Model Used

GPT-5

### Debug Log References

 - `node --test monitor/auth.test.js monitor/monitor-ui.test.js`

### Completion Notes List

- public/monitor.html sert une page monitor simple et reference monitor.js/monitor.css.
- Assets monitor.js et monitor.css ajoutes avec style de base et stub JS.
- Auth pose un cookie HttpOnly apres authentification pour les assets monitor.
- Cookie Secure active quand la requete est en HTTPS.
- Tests UI verifient les references et la presence des assets.

### File List

- monitor/auth.js
- monitor/auth.test.js
- monitor/monitor-ui.test.js
- public/monitor.html
- public/monitor.js
- public/monitor.css
- _bmad-output/implementation-artifacts/1-2-serve-the-monitor-ui-on-a-dedicated-route.md
