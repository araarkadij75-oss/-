# MASTER AI — RELEASE STATUS

## CURRENT
- Version: **18.17.15-CURRENT**
- Release date: 2026-09-20
- Web: https://araarkadij75-oss.github.io/-/
- Firebase project: `master-ai-beta-9440599`
- Workspace: `master-ai-beta`
- Billing: **Spark / no billing**
- Canonical orders source: Firestore `workspaces/master-ai-beta/orders`
- Google mirror: spreadsheet `1BA1Lwmpk62xacOBvX_EW02gBhIJvOfW5EOTYFWeOD0o`, sheet `Заказы`

## RELEASE GATE EVIDENCE
- Main source/static gate: **18/18 PASS**
- Exact bootstrap unit test:
  - empty cache -> one bounded Firestore snapshot, then delta realtime: **PASS**
  - warm cache -> zero full bootstrap reads, direct delta realtime: **PASS**
- Runtime owner ping: **PASS**
- Firestore orders: **1145**
- Google rows: **1145**
- Google unique IDs: **1145**
- Duplicate IDs: **0**
- Technical E2E/self-test IDs in Google: **0**
- Google Bridge: **configured / OK**
- Pending bridge rows: **0**
- Pending bridge deletes: **0**
- Delta dead-letter: **false**
- Durable pending deletes: **0**
- Full reconciliation: **manual_only**
- Legacy automatic full sync: **blocked**
- Auto full sync on open: **false**
- Focus full pull: **false**
- Delta realtime: **true**
- Repeated owner restart: auto full-sync requests remained **0**
- Dispatcher-logistic page: **smoke PASS**
- Master page: **smoke PASS**

## IMPORTANT FIX IN 18.17.15
18.17.14 still had a first-run fallback: when the local IndexedDB cache contained fewer than 500 orders, the quota-safe patch could return to the legacy subscriber. The legacy subscriber could request full Google reconciliation on coordinator open, focus, Firestore changes, and every 15 minutes.

18.17.15 removes that fallback. A cold client now performs one bounded Firestore bootstrap snapshot and immediately switches to delta realtime. The legacy `requestGoogleSync()` automatic path is also hard-blocked; explicit manual reconciliation remains available.

## DATA SAFETY
- Direct Google synchronization is idempotent `upsert/delete`.
- Technical IDs are filtered.
- Retry is bounded to 5 attempts with dead-letter state.
- Owner is the Google write coordinator.
- Full reconciliation is manual-only.
- No Blaze/billing was enabled.

### Observation: order 260919-001
The pre-cleanup Google backup contains order `260919-001`, but the current canonical Firestore and current Google mirror both do not contain it. The release did **not** recreate it automatically because that would risk resurrecting a legitimately deleted order. The backup row is still recoverable if a later audit proves the deletion was accidental.

## VERSION LAYOUT
- CURRENT: `main` -> 18.17.15
- CANDIDATE: `candidate/v18.17.15-bootstrap-delta`
- ARCHIVE: `archive/v18.17.14`
- BACKUP / rollback: `backup/v18.17.14-current`
- Exact pre-18.17.15 rollback commit: `8eecc7a4954bc23c6c0ed3e7bcd1e750a2e888e3`

## ROLLBACK
If 18.17.15 shows a release regression, restore root application files from `backup/v18.17.14-current`. Do not modify Firestore data during a code rollback unless a separate data audit proves it is necessary.
