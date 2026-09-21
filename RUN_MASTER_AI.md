# MASTER AI — START / DAILY USE

## Owner
Open:
https://araarkadij75-oss.github.io/-/

## Dispatcher-logistic
Open:
https://araarkadij75-oss.github.io/-/dispatcher-logistic.html

## Master
Open:
https://araarkadij75-oss.github.io/-/master.html

## Normal operation
The working release is **18.17.18-CURRENT**.

Ordinary synchronization is:
- Firestore realtime
- direct idempotent Google `upsert/delete`
- no automatic full Google merge on open, focus, timer, or Firestore change

Do not use manual full reconciliation during normal daily work.

## Quick health check
Owner diagnostic:
https://araarkadij75-oss.github.io/-/index.html?integrationDiag=ping

Healthy state should show:
- build `18.17.18-CURRENT`
- Firestore orders = Google rows
- currently expected count: `1145`
- Google `ok: true`
- `bridgeProtocol: 2`
- `legacyBridgeEndpointDisabled: true`
- `bridgePendingRows: 0`
- `bridgePendingDeletes: 0`
- `pendingDurableDeletes: 0`
- `deltaDeadLetter: false`
- `deleteDeadLetter: false`
- `canonicalDeleteSafety: true`
- `fullReconcileMode: manual_only`
- `legacyAutoFullSyncBlocked: true`
- `autoFlushOnOpen: false`
- `focusPull: false`

## Billing
Keep Firebase on Spark / no billing. Do not enable Blaze unless separately approved by the owner.
