# MASTER AI — RELEASE STATUS

## CURRENT
- Version: **18.17.18-CURRENT**
- Date: 2026-09-21
- Web: https://araarkadij75-oss.github.io/-/
- Firebase project: `master-ai-beta-9440599`
- Workspace: `master-ai-beta`
- Billing: **Spark / NO BILLING**
- Canonical orders source: Firestore `workspaces/master-ai-beta/orders`
- Google mirror: spreadsheet `1BA1Lwmpk62xacOBvX_EW02gBhIJvOfW5EOTYFWeOD0o`, sheet `Заказы`

## FINAL LIVE GATE
- Root build: **18.17.18-CURRENT**
- Firestore orders: **1145**
- Google rows: **1145**
- Google unique IDs: **1145**
- Duplicate IDs: **0**
- Technical E2E/self-test rows in Google: **0**
- Google Bridge: **OK / Protocol v2**
- Legacy Bridge endpoint: **disabled**
- Automatic legacy full reconciliation: **blocked**
- Full reconciliation mode: **manual_only**
- Bridge pending rows: **0**
- Bridge pending deletes: **0**
- Durable pending deletes: **0**
- Delta dead-letter: **false**
- Delete dead-letter: **false**
- Auto full-sync requests after load: **0**
- Last full reconciliation timestamp remained **2026-09-20T12:08:49.349Z** through final E2E.
- Dispatcher-logistic page: **smoke PASS**
- Master page: **smoke PASS**

## FINAL E2E — 18.17.18
Technical ID: `INTEG-E2E-260921-181718-FINAL`

Create:
- canonical Firestore order created: **PASS**
- exactly one Google row created: **PASS**

Delete:
- `canonicalDeleted=true`: **PASS**
- Firestore `exists=false`: **PASS**
- `tombstoneResolved=true`: **PASS**
- `auxFailures=[]`: **PASS**
- permission errors: **0**
- Google row after delete: **0**
- final Google count returned to **1145**
- final technical IDs in Google: **0**

## SAFETY FIXES IN CURRENT
- Cold client uses one bounded Firestore bootstrap snapshot, then delta realtime.
- No fallback to the legacy automatic full-sync subscriber.
- Old `requestGoogleSync()` automatic path is hard-blocked.
- Bridge Protocol v2 disables the legacy endpoint used by stale clients.
- Ordinary Google writes are idempotent direct `upsert/delete`.
- Canonical delete is handled separately from auxiliary mirror cleanup.
- Canonical delete is mandatory and bounded; auxiliary mirror deletion uses failure isolation.
- Correct mirror path `masterPhones` is used; obsolete `phoneAccess` path is absent.
- Google delete is queued only after canonical Firestore deletion succeeds.
- Retry is bounded and dead-letter state is surfaced.
- Technical tombstones are safely resolved.
- No Blaze/billing enable path was introduced.

## VERSION LAYOUT
- CURRENT: `main` -> **18.17.18**
- BACKUP: `backup/v18.17.18-current`
- Previous safe rollback: `backup/v18.17.16-current`
- Failed/rejected 18.17.17 work must not be used as CURRENT.
- Candidate source retained for audit: `candidate/v18.17.18-delete-safety`
- ARCHIVE: `archive/v18.17.14`

## DATA SAFETY OBSERVATION
The old backup contains order `260919-001`, while current canonical Firestore and current Google mirror do not contain it. It is intentionally not resurrected automatically because that could restore a legitimately deleted order.

## ROLLBACK
For a frontend regression, restore root application files from `backup/v18.17.18-current` only if rolling back changes made after this release. For rollback specifically to the prior verified release, use `backup/v18.17.16-current`. Do not modify Firestore data during a code rollback unless a separate data audit proves a data repair is required.
