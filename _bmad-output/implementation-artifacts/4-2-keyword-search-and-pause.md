# Story 4.2: Recherche par mot-cle et pause du flux

Status: done

<!-- Note: Validation optional. Run validate-create-story for quality check before dev-story. -->

## Story

En tant qu'administrateur,
je veux rechercher par mot-cle et mettre en pause le flux,
afin d'inspecter les logs sans perdre le contexte.

## Acceptance Criteria

1. Etant donne que la liste des logs est visible,
   quand je saisis un mot-cle,
   alors seuls les logs correspondants sont affiches.
2. Etant donne que le flux est actif,
   quand je clique sur Pause,
   alors l'UI n'ajoute plus de nouveaux logs tant que je ne reprends pas.

## Tasks / Subtasks

- [x] Ajouter un champ de recherche et un bouton Pause/Reprendre (AC: 1, 2)
  - [x] Input texte pour mot-cle
  - [x] Bouton toggle Pause/Reprendre
- [x] Mettre a jour public/monitor.css pour les controles (AC: 1, 2)
- [x] Implementer la recherche et la pause dans public/monitor.js (AC: 1, 2)
  - [x] Stocker mot-cle courant
  - [x] Filtrer par mot-cle lors du rendu
  - [x] Bloquer l'append quand en pause
- [x] Ajouter tests UI simples (AC: 1, 2)
  - [x] Presence du champ de recherche
  - [x] Presence du bouton pause
  - [x] Presence de la logique de pause

## Dev Notes

- JS sans framework.
- Ne pas changer le format des logs.
- Pas de dependances nouvelles.

### Project Structure Notes

- public/monitor.html (a etendre)
- public/monitor.js (a ajuster)
- public/monitor.css (a ajuster)
- monitor/monitor-client.test.js (a etendre)

### References

- `_bmad-output/planning-artifacts/epics.md` (Epic 4, Story 4.2)
- `_bmad-output/planning-artifacts/architecture.md` (Frontend)
- `_bmad-output/project-context.md` (Rules)

## Dev Agent Record

### Agent Model Used

GPT-5

### Debug Log References

 - `node --test monitor/monitor-client.test.js`

### Completion Notes List

- Champ de recherche et bouton Pause/Reprendre ajoutes dans l'UI.
- Filtrage par mot-cle applique sur les logs existants et nouveaux.
- Pause bloque l'append jusqu'a reprise.
- Recherche robuste si context est circulaire (try/catch stringify).

### File List

- public/monitor.html
- public/monitor.js
- public/monitor.css
- monitor/monitor-client.test.js
- _bmad-output/implementation-artifacts/4-2-keyword-search-and-pause.md
