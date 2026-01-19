# Story 2.3: Streamer les logs via SSE

Status: done

<!-- Note: Validation optional. Run validate-create-story for quality check before dev-story. -->

## Story

En tant qu'administrateur,
je veux recevoir les logs en temps reel via SSE,
afin de voir les incidents sans recharger la page.

## Acceptance Criteria

1. Etant donne un client connecte a GET /monitor/stream avec token valide,
   quand un nouveau log est emis,
   alors un event SSE "log" est envoye avec { ts, level, message, context } dans 1s.
2. Etant donne plusieurs clients (1 principal, 2-3 max),
   quand les logs arrivent,
   alors chaque client recoit le stream sans interruption.
3. Etant donne une erreur de stream,
   quand le serveur detecte l'erreur,
   alors un event SSE "error" est envoye puis la connexion est fermee.

## Tasks / Subtasks

- [x] Implementer le stream SSE dans monitor/routes.js (AC: 1, 2, 3)
  - [x] Initialiser headers SSE (Content-Type: text/event-stream, Cache-Control: no-store, Connection: keep-alive)
  - [x] Envoyer un event "log" pour chaque entree (via onLog)
  - [x] Gerer la liste des clients SSE
  - [x] Gerer la fermeture propre des connexions
- [x] Envoyer les logs existants a la connexion (AC: 1)
  - [x] Rejouer getLastLogs() a la connexion (optionnel si defini)
- [x] Ajouter tests unitaires pour le format SSE (AC: 1)
  - [x] Verifier le prefixe "event: log" et "data:" JSON

## Dev Notes

- ESM uniquement (type: module), pas de require.
- SSE uniquement (pas de WebSocket).
- Headers SSE: Content-Type: text/event-stream, Cache-Control: no-store, Connection: keep-alive.
- Payload: { ts, level, message, context }.
- Utiliser onLog() du monitor pour diffuser.

### Project Structure Notes

- monitor/routes.js (a etendre)
- monitor/monitor.js (onLog, getLastLogs)

### References

- `_bmad-output/planning-artifacts/epics.md` (Epic 2, Story 2.3)
- `_bmad-output/planning-artifacts/architecture.md` (SSE Format Patterns)
- `_bmad-output/project-context.md` (Critical rules)

## Dev Agent Record

### Agent Model Used

GPT-5

### Debug Log References

 - `node --test monitor/monitor.test.js monitor/sse.test.js`

### Completion Notes List

- /monitor/stream renvoie un flux SSE avec event "log" et payload JSON.
- Rejoue le backlog getLastLogs a la connexion.
- En cas d'erreur d'ecriture, envoie event "error" et ferme la connexion.
- Heartbeat SSE toutes les 20s pour maintenir la connexion.
- Test SSE skip si express non installe localement.

### File List

- monitor/routes.js
- monitor/sse.test.js
- _bmad-output/implementation-artifacts/2-3-stream-new-logs-via-sse.md
