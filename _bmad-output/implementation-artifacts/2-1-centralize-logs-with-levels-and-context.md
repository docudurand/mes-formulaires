# Story 2.1: Centraliser les logs avec niveau et contexte

Status: done

<!-- Note: Validation optional. Run validate-create-story for quality check before dev-story. -->

## Story

En tant que developpeur,
je veux un logger central qui enregistre le niveau et le contexte,
afin de normaliser les logs pour le streaming.

## Acceptance Criteria

1. Etant donne un log emis avec niveau, message et contexte optionnel,
   quand le logger le traite,
   alors il stocke un objet { ts, level, message, context }.
2. Etant donne que le logger recoit info, warn ou error,
   quand l'entree est traitee,
   alors le niveau est conserve et pourra etre filtre.

## Tasks / Subtasks

- [x] Creer monitor/monitor.js pour centraliser la logique de log (AC: 1, 2)
  - [x] Exposer une fonction log(level, message, context)
  - [x] Normaliser ts en ISO 8601
- [x] Definir un format unique de log { ts, level, message, context } (AC: 1)
  - [x] Valider level in [info, warn, error]
  - [x] Si level invalide, le normaliser en info
- [x] Preparer l'export pour le streaming (AC: 2)
  - [x] Exposer une fonction getLastLogs() (pour buffer)
  - [x] Exposer un hook onLog(listener) (pour SSE)

## Dev Notes

- ESM uniquement (type: module), pas de require.
- Pas de persistance disque (memoire uniquement).
- Ne pas implementer SSE ici (Epic 2.3).
- Buffer FIFO a implementer en Story 2.2.
- Pas de nouvelles dependances.

### Project Structure Notes

- monitor/monitor.js (nouveau)
- Pas d'impact sur server.js ici.

### References

- `_bmad-output/planning-artifacts/epics.md` (Epic 2, Story 2.1)
- `_bmad-output/planning-artifacts/architecture.md` (Data Architecture, Format Patterns)
- `_bmad-output/project-context.md` (Critical rules)

## Dev Agent Record

### Agent Model Used

GPT-5

### Debug Log References

 - `node --test monitor/monitor.test.js`

### Completion Notes List

- Logger central en memoire avec format { ts, level, message, context }.
- Niveau normalise (info/warn/error), fallback info si invalide.
- Hooks exposes: log, getLastLogs, onLog.
- getLastLogs renvoie une copie defensive des entries.
- Si message est une Error, details stockes dans context.error.

### File List

- monitor/monitor.js
- monitor/monitor.test.js
- _bmad-output/implementation-artifacts/2-1-centralize-logs-with-levels-and-context.md
