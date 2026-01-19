# Story 4.3: Exporter les logs recents

Status: done

<!-- Note: Validation optional. Run validate-create-story for quality check before dev-story. -->

## Story

En tant qu'administrateur,
je veux exporter les logs recents en JSON,
afin de pouvoir archiver ou partager les incidents.

## Acceptance Criteria

1. Etant donne que des logs sont en memoire,
   quand je declenche l'export,
   alors un fichier JSON des logs recents est telecharge.
2. Etant donne que le flux est actif,
   quand j'exporte,
   alors l'export n'interrompt pas le streaming.

## Tasks / Subtasks

- [x] Ajouter un bouton Export dans public/monitor.html (AC: 1)
- [x] Ajouter styles de base dans public/monitor.css (AC: 1)
- [x] Implementer l'export dans public/monitor.js (AC: 1, 2)
  - [x] Recuperer les logs via endpoint existant ou nouveau
  - [x] Generer et declencher un download JSON
- [x] Ajouter tests UI simples (AC: 1)
  - [x] Presence du bouton Export

## Dev Notes

- JS sans framework.
- Si besoin, ajouter un endpoint simple qui renvoie getLastLogs().
- Ne pas casser SSE.

### Project Structure Notes

- public/monitor.html (a etendre)
- public/monitor.js (a ajuster)
- public/monitor.css (a ajuster)
- monitor/routes.js (si ajout endpoint)
- monitor/monitor-client.test.js (a etendre)

### References

- `_bmad-output/planning-artifacts/epics.md` (Epic 4, Story 4.3)
- `_bmad-output/planning-artifacts/architecture.md` (Frontend)
- `_bmad-output/project-context.md` (Rules)

## Dev Agent Record

### Agent Model Used

GPT-5

### Debug Log References

 - `node --test monitor/monitor-client.test.js`

### Completion Notes List

- Bouton Export ajoute et telecharge un JSON des logs.
- Endpoint /monitor/logs expose getLastLogs pour l'export.
- L'export n'interrompt pas le flux SSE.

### File List

- public/monitor.html
- public/monitor.js
- public/monitor.css
- monitor/routes.js
- monitor/monitor-client.test.js
- _bmad-output/implementation-artifacts/4-3-export-recent-logs.md
