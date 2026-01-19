# Story 4.1: Filtrer les logs par niveau

Status: done

<!-- Note: Validation optional. Run validate-create-story for quality check before dev-story. -->

## Story

En tant qu'administrateur,
je veux filtrer la liste des logs par niveau,
afin de me concentrer sur les erreurs ou warnings.

## Acceptance Criteria

1. Etant donne que plusieurs niveaux sont presents,
   quand je selectionne un niveau (info/warn/error),
   alors seuls les logs correspondants sont affiches.
2. Etant donne que le filtre est actif,
   quand de nouveaux logs arrivent,
   alors seuls ceux du niveau selectionne sont ajoutes.

## Tasks / Subtasks

- [x] Ajouter un select de filtre dans public/monitor.html (AC: 1)
  - [x] Options: all/info/warn/error
  - [x] Position visible au-dessus de la liste
- [x] Ajouter styles de base dans public/monitor.css (AC: 1)
- [x] Implementer le filtrage dans public/monitor.js (AC: 1, 2)
  - [x] Stocker le filtre courant
  - [x] Appliquer le filtre lors de l'append
- [x] Ajouter tests UI simples (AC: 1, 2)
  - [x] Presence du select
  - [x] Presence de la logique de filtre

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

- `_bmad-output/planning-artifacts/epics.md` (Epic 4, Story 4.1)
- `_bmad-output/planning-artifacts/architecture.md` (Frontend)
- `_bmad-output/project-context.md` (Rules)

## Dev Agent Record

### Agent Model Used

GPT-5

### Debug Log References

 - `node --test monitor/monitor-client.test.js`

### Completion Notes List

- Filtre par niveau ajoute avec select (all/info/warn/error).
- La liste est rendue selon le filtre courant, y compris sur nouveaux logs.
- Styles de base pour le select.

### File List

- public/monitor.html
- public/monitor.js
- public/monitor.css
- monitor/monitor-client.test.js
- _bmad-output/implementation-artifacts/4-1-filter-logs-by-level.md
