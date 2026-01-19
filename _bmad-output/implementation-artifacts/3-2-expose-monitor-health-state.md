# Story 3.2: Exposer l'etat de sante du monitor

Status: done

<!-- Note: Validation optional. Run validate-create-story for quality check before dev-story. -->

## Story

En tant qu'administrateur,
je veux un endpoint /monitor/health,
afin de verifier l'etat du monitor independamment de /healthz.

## Acceptance Criteria

1. Etant donne que le monitor est actif,
   quand GET /monitor/health est appele avec token valide,
   alors il retourne JSON { status: "ok" | "error", lastErrorAt }.
2. Etant donne un log error enregistre,
   quand /monitor/health est appele,
   alors status="error" et lastErrorAt est renseigne.

## Tasks / Subtasks

- [x] Mettre a jour /monitor/health dans monitor/routes.js (AC: 1, 2)
  - [x] Retourner { status, lastErrorAt }
  - [x] Mettre a jour le statut a chaque log error
- [x] Ajouter un tracker d'erreurs dans monitor/monitor.js (AC: 2)
  - [x] Stocker lastErrorAt
  - [x] Exposer getHealthStatus()
- [x] Ajouter tests unitaires health (AC: 1, 2)
  - [x] Status ok par defaut
  - [x] Status error apres log error

## Dev Notes

- ESM uniquement (type: module), pas de require.
- Pas de persistance.
- Utiliser log() pour detecter error.

### Project Structure Notes

- monitor/monitor.js (a etendre)
- monitor/routes.js (a ajuster)

### References

- `_bmad-output/planning-artifacts/epics.md` (Epic 3, Story 3.2)
- `_bmad-output/planning-artifacts/architecture.md` (Health endpoint)
- `_bmad-output/project-context.md` (Rules)

## Dev Agent Record

### Agent Model Used

GPT-5

### Debug Log References

 - `node --test monitor/monitor.test.js monitor/monitor-health.test.js monitor/monitor-health-route.test.js`

### Completion Notes List

- getHealthStatus expose status ok/error et lastErrorAt.
- lastErrorAt est mis a jour lors des logs error et redevient ok quand l'erreur est ancienne.
- /monitor/health renvoie l'etat via monitor/routes.js.
- Le test de route saute si express n'est pas installe.

### File List

- monitor/monitor.js
- monitor/routes.js
- monitor/monitor-health.test.js
- monitor/monitor-health-route.test.js
- _bmad-output/implementation-artifacts/3-2-expose-monitor-health-state.md
