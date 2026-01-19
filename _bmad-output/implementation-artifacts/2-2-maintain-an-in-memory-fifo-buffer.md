# Story 2.2: Maintenir un buffer FIFO en memoire

Status: review

<!-- Note: Validation optional. Run validate-create-story for quality check before dev-story. -->

## Story

En tant que developpeur,
je veux stocker les logs dans un buffer en memoire borne,
afin de conserver les logs recents sans persistance.

## Acceptance Criteria

1. Etant donne que le buffer atteint 500 logs ou 5 minutes de retention,
   quand un nouveau log arrive,
   alors les plus anciens sont evinces en FIFO.
2. Etant donne une surcharge,
   quand des logs sont perdus,
   alors le systeme continue sans crash.

## Tasks / Subtasks

- [x] Ajouter un buffer FIFO dans monitor/monitor.js (AC: 1)
  - [x] Limiter a 500 entries (par defaut)
  - [x] Conserver max 5 minutes (timestamp)
  - [x] Eviction FIFO des plus anciens
- [x] Exposer getLastLogs() en respectant la retention (AC: 1)
  - [x] Ne retourner que le buffer courant
- [x] Ajouter tests unitaires pour retention taille/temps (AC: 1)
  - [x] Test eviction par taille
  - [x] Test eviction par age
- [x] Tolerer perte de logs sans crash (AC: 2)
  - [x] Verifier qu'une exception listener n'arrete pas l'append

## Dev Notes

- ESM uniquement (type: module), pas de require.
- Buffer FIFO memoire uniquement, pas de persistance.
- Log format { ts, level, message, context }.
- Pas de nouvelles dependances.

### Project Structure Notes

- monitor/monitor.js (a etendre)
- monitor/monitor.test.js (a etendre)

### References

- `_bmad-output/planning-artifacts/epics.md` (Epic 2, Story 2.2)
- `_bmad-output/planning-artifacts/architecture.md` (Buffer & Process Patterns)
- `_bmad-output/project-context.md` (Critical rules)

## Dev Agent Record

### Agent Model Used

GPT-5

### Debug Log References

 - `node --test monitor/monitor.test.js`

### Completion Notes List

- Buffer FIFO limite a 500 logs et 5 minutes avec eviction des plus anciens.
- getLastLogs applique la retention et renvoie une copie defensive.
- Exceptions des listeners ignorees (pas de crash).
- Tests ajoutés pour eviction taille/age et tolérance erreurs listener.

### File List

- monitor/monitor.js
- monitor/monitor.test.js
- _bmad-output/implementation-artifacts/2-2-maintain-an-in-memory-fifo-buffer.md
