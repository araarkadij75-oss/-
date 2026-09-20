# MASTER AI — START / DAILY USE

## Owner
Open:
https://araarkadij75-oss.github.io/-/

Use the existing online owner session/login. The header must show the online application and orders should load from the shared Firestore workspace.

## Dispatcher-logistic
Open:
https://araarkadij75-oss.github.io/-/dispatcher-logistic.html

Sign in with the existing dispatcher-logistic account/PIN.

## Master
Open:
https://araarkadij75-oss.github.io/-/master.html

Sign in with the existing master account/PIN.

## Normal synchronization
No manual full synchronization is required for ordinary work. Changes use Firestore realtime plus direct idempotent Google `upsert/delete`.

Use full reconciliation only as an explicit diagnostic/recovery action after checking counts and backups.

## Quick health check
Owner diagnostic URL:
https://araarkadij75-oss.github.io/-/index.html?integrationDiag=ping

Healthy 18.17.15 should report:
- build `18.17.15-CURRENT`
- Firestore orders equal Google rows
- Google `ok: true`
- `bridgePendingRows: 0`
- `bridgePendingDeletes: 0`
- `deltaDeadLetter: false`
- `fullReconcileMode: manual_only`
- `legacyAutoFullSyncBlocked: true`
- `autoFlushOnOpen: false`
- `focusPull: false`

## Billing
Keep Firebase on Spark/no-billing. Do not enable Blaze unless separately approved by the owner.
