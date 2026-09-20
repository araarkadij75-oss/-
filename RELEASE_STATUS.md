# MASTER AI — RELEASE STATUS

## CURRENT
- Version: **18.17.17-CURRENT**
- Date: 2026-09-21
- Web: https://araarkadij75-oss.github.io/-/
- Firebase project: `master-ai-beta-9440599`
- Workspace: `master-ai-beta`
- Billing: **Spark / no billing**
- Canonical orders source: Firestore `workspaces/master-ai-beta/orders`
- Google mirror: spreadsheet `1BA1Lwmpk62xacOBvX_EW02gBhIJvOfW5EOTYFWeOD0o`, sheet `Заказы`

## CURRENT DATA STATE
- Google rows: **1145**
- Google unique order IDs: **1145**
- Duplicate IDs: **0**
- Technical E2E/self-test IDs in Google: **0**
- Last failed diagnostic E2E ID `INTEG-E2E-260921-181717-FINAL`: absent from Google and canonical Firestore.
- Bridge Protocol: **v2**
- Legacy Bridge endpoint: **disabled**
- Automatic legacy full reconciliation: **blocked**
- Full reconciliation: **manual_only**
- Production project `master-ai-9440599`: frozen / not a target.
- Blaze/billing: **not enabled**

## KNOWN RELEASE HOLD
18.17.17 exposed a delete-path defect during a technical E2E: its diagnostic override referenced the obsolete/nonexistent `phoneAccess` path while the real phone mirror is `masterPhones`. The canonical Firestore order and Google row were deleted, but the diagnostic returned `permission-denied` during auxiliary cleanup.

The embedded legacy owner delete path also performs canonical + mirror deletions in one `Promise.all`. That can report the whole deletion as failed when an auxiliary mirror delete fails even after the canonical order is already removed.

Because Firebase Console currently reports the Spark daily usage limit exceeded, no additional live Firestore E2E should be created until quota recovers.

## CANDIDATE
- Version: **18.17.18-CANDIDATE**
- Branch: `candidate/v18.17.18-delete-safety`
- Rollback before candidate work: `backup/v18.17.17-current`
- Static release gate: **29/29 PASS**
- Exact delete-function unit scenarios: **5/5 PASS**

### 18.17.18 delete safety
- Legacy owner deletion receives `deleted=[]`; the quota-safe path becomes the single delete coordinator.
- Durable tombstone is persisted before destructive deletion.
- Canonical `orders/{orderId}` deletion is mandatory and retried at most 3 times.
- Auxiliary mirrors `dispatcherOrders`, `masterAssignments`, `masterPhones` use `Promise.allSettled`; their failure cannot falsely undo a successful canonical deletion.
- Google delete is queued only after canonical deletion succeeds.
- Permanent canonical failure does **not** queue Google deletion and is recorded in delete diagnostics/dead-letter.
- Wrong `phoneAccess` path is absent from the candidate.
- Direct Google synchronization remains idempotent `upsert/delete`.
- Full reconciliation remains Firestore -> Google and manual-only.
- Bridge retry remains bounded to 5 attempts with dead-letter.

## LIVE GATE STILL REQUIRED FOR 18.17.18
After Spark daily quota recovers:
1. Open candidate owner preview.
2. Run one technical E2E create.
3. Confirm exactly one Firestore canonical order and one Google row.
4. Run delete.
5. Confirm canonical Firestore order absent.
6. Confirm Google row absent.
7. Confirm pending durable deletes = 0.
8. Confirm bridge queues = 0 and delete dead-letter = false.
9. Confirm full-reconcile `lastSuccessAt` did not move because of the E2E.
10. Re-read Google count/unique count and require 1145/1145 with zero technical IDs before promotion.

## DATA SAFETY OBSERVATION
The pre-cleanup Google backup contains order `260919-001`, but current canonical Firestore and current Google mirror both do not contain it. It is intentionally not recreated automatically; doing so could resurrect a legitimately deleted order.

## VERSION LAYOUT
- CURRENT: `main` -> 18.17.17
- CANDIDATE: `candidate/v18.17.18-delete-safety`
- BACKUP: `backup/v18.17.17-current`
- Previous backups: `backup/v18.17.16-current`, `backup/v18.17.15-current`, `backup/v18.17.14-current`
- ARCHIVE: `archive/v18.17.14`

## ROLLBACK
For a frontend regression, restore root application files from the appropriate backup branch. Do not modify Firestore data during a code rollback unless a separate data audit proves a data repair is necessary.
