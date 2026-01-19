# Story 1.3: Monter les routes de monitoring via un module dedie

Status: done

<!-- Note: Validation optional. Run validate-create-story for quality check before dev-story. -->

## Story

En tant que developpeur,
je veux isoler les routes de monitoring dans un module dedie,
afin que server.js ne fasse que monter ce module.

## Acceptance Criteria

1. Etant donne que le module monitor/ existe,
   quand server.js demarre,
   alors il monte /monitor, /monitor/stream, et /monitor/health depuis ce module.
2. Etant donne que l'endpoint global /healthz existe,
   quand GET /healthz est appele,
   alors il reste distinct de /monitor/health.

## Tasks / Subtasks

- [x] Creer monitor/routes.js pour regrouper les routes /monitor, /monitor/stream, /monitor/health (AC: 1)
  - [x] Exporter un router Express (ESM)
  - [x] Reutiliser les handlers actuels depuis server.js
- [x] Monter le module monitor dans server.js (AC: 1)
  - [x] Remplacer les routes monitor inline par app.use("/monitor", monitorRoutes)
  - [x] Conserver l'auth middleware existant sur /monitor et assets
- [x] Verifier la separation /healthz vs /monitor/health (AC: 2)
  - [x] Confirmer que /healthz repond toujours 200 OK
  - [x] Confirmer que /monitor/health reste dans le module monitor

## Dev Notes

- ESM uniquement (type: module), pas de require.
- Conserver la structure monitor/ et public/.
- Ne pas casser les routes existantes.
- Pas de nouvelles dependances.

### Project Structure Notes

- Nouveau module: monitor/routes.js
- server.js doit uniquement monter le module monitor
- Auth: monitor/auth.js (deja en place)

### References

- `_bmad-output/planning-artifacts/epics.md` (Epic 1, Story 1.3)
- `_bmad-output/planning-artifacts/architecture.md` (Project Structure & Boundaries)
- `_bmad-output/project-context.md` (Framework rules)

## Dev Agent Record

### Agent Model Used

GPT-5

### Debug Log References

 - `node --test monitor/auth.test.js monitor/monitor-ui.test.js`

### Completion Notes List

- Routes monitor regroupees dans monitor/routes.js.
- server.js monte le module /monitor et conserve /healthz distinct.
- /monitor/stream present (placeholder 501) en attendant SSE.
- Fixes de revue: import monitorRoutes corrige et suppression du } ); orphelin.
- Auth cookie decode pour tokens encodes (ex: '!').

### File List

- monitor/routes.js
- monitor/auth.js
- monitor/auth.test.js
- server.js
- _bmad-output/implementation-artifacts/1-3-mount-monitoring-routes-from-a-dedicated-module.md
