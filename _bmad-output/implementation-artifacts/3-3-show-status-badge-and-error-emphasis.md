# Story 3.3: Afficher un badge de statut et une emphase erreur

Status: done

<!-- Note: Validation optional. Run validate-create-story for quality check before dev-story. -->

## Story

En tant qu'administrateur,
je veux un indicateur OK/ERREUR clair,
afin de detecter les problemes immediatement.

## Acceptance Criteria

1. Etant donne que la page se charge,
   quand /monitor/health retourne status "ok",
   alors l'UI affiche un badge vert OK.
2. Etant donne qu'un log error est recu ou que /monitor/health retourne "error",
   quand l'UI se met a jour,
   alors le badge passe en rouge clignotant ERREUR.

## Tasks / Subtasks

- [x] Ajouter un badge de statut dans public/monitor.html (AC: 1, 2)
  - [x] Texte explicite OK/ERREUR
  - [x] Zone visible en haut de page
- [x] Ajouter les styles dans public/monitor.css (AC: 1, 2)
  - [x] Variantes ok/error (vert/rouge)
  - [x] Animation clignotante pour l'etat error
- [x] Mettre a jour public/monitor.js (AC: 1, 2)
  - [x] Charger /monitor/health au demarrage et appliquer le badge
  - [x] Passer en error lors d'un log error ou d'une reponse health error
- [x] Ajouter tests UI (AC: 1, 2)
  - [x] Verifier presence du badge
  - [x] Verifier classes ok/error appliquees

## Dev Notes

- JS sans framework.
- Utiliser /monitor/health pour initialiser l'etat.
- Ne pas changer l'auth existante.

### Project Structure Notes

- public/monitor.html (a etendre)
- public/monitor.js (a ajuster)
- public/monitor.css (a ajuster)
- monitor/monitor-client.test.js (a etendre)

### References

- `_bmad-output/planning-artifacts/epics.md` (Epic 3, Story 3.3)
- `_bmad-output/planning-artifacts/architecture.md` (Frontend Architecture)
- `_bmad-output/project-context.md` (Rules)

## Dev Agent Record

### Agent Model Used

GPT-5

### Debug Log References

 - `node --test monitor/monitor-client.test.js`

### Completion Notes List

- Badge OK/ERREUR ajoute et initialise via /monitor/health.
- Passage immediat en etat erreur lors d'un log error ou d'un incident SSE.
- Style clignotant rouge pour l'etat error.

### File List

- public/monitor.html
- public/monitor.js
- public/monitor.css
- monitor/monitor-client.test.js
- _bmad-output/implementation-artifacts/3-3-show-status-badge-and-error-emphasis.md
