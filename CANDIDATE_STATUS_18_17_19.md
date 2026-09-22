# MASTER AI 18.17.19 — CANDIDATE CERTIFICATION STATUS

Date: 2026-09-22

## Baseline

- Base CURRENT: `18.17.18-CURRENT`
- Candidate: `18.17.19-CANDIDATE`
- Branch: `candidate/v18.17.19-certification`
- Firebase: `master-ai-beta-9440599`
- Workspace: `master-ai-beta`
- Billing: **Spark / NO BILLING**
- Canonical orders: `workspaces/master-ai-beta/orders`
- Active Google mirror: `1BA1Lwmpk62xacOBvX_EW02gBhIJvOfW5EOTYFWeOD0o`

The candidate does not switch environments and does not touch legacy PROD `master-ai-9440599`.

## Closed gates in this candidate

### Reproducible release gate
- machine-readable `release-state.json`
- `package.json`
- `firebase.json`
- GitHub Actions candidate gate
- static contract tests
- Firestore Rules emulator matrix

### Server-side RBAC contract
Candidate rules and emulator tests cover:
- anonymous denied
- inactive member denied
- owner canonical CRUD
- dispatcher intake-only canonical create/update
- dispatcher cannot assign master, edit money, or delete
- dispatcher-logistic can operate but cannot canonical-delete
- logistic can update but cannot create/delete canonical orders
- master can read only own assignment/order
- master cannot list other assignments
- master may update only workflow/report fields
- master cannot change money/client phone
- Google Bridge config owner-only
- UI config owner-write / active-user read

### Phone privacy
`masterPhones/{orderId}` is server-time gated:
- wrong master: denied
- future unlock time: denied
- past unlock time: allowed
- explicit early access: allowed

This is enforced by candidate Firestore Rules, not CSS or client-only logic.

### PWA
- real service worker registration in all three role entrypoints
- offline shell cache
- navigation fallback
- `cloud-config.js` and quota-safe patch use network-first behavior
- old MASTER AI caches are removed on activation

### Diagnostics
Owner URL diagnostics are restricted to read-only modes:
- `ping`
- `dry`
- `read`

Mutation URL modes (`create/delete/sync`) are no longer accepted by the candidate entrypoint.

### Release integrity
- `quota-safe-v181718.js` remains unchanged as 18.17.18 rollback material.
- candidate has separate `quota-safe-v181719.js`.
- candidate runtime identifies itself as `18.17.19-CANDIDATE`.
- direct idempotent upsert/delete retained.
- canonical-delete safety retained.
- full reconciliation remains `manual_only`.
- legacy automatic full sync remains blocked.
- focus/open full pulls remain disabled.
- retry remains bounded.
- Spark/no-billing contract retained.

## Live facts independently confirmed on 2026-09-22

- Firebase project is still on Spark.
- Firebase Authentication has generated MASTER AI accounts and Email/Password is enabled.
- Current live auth therefore still uses the existing deterministic PIN-derived credential model.
- Apps Script project has **0 installable triggers**.
- Current 18.17.18 diagnostic page reports `owner session not connected` when no owner session is active.
- Therefore live Google delivery still depends on an owner coordinator session.

## Open promotion blockers

1. **Candidate Firestore Rules are tested but NOT deployed to live Firebase.**
   Production rule text could not be independently retrieved with the available read-only connector.

2. **Authenticated live E2E is still required after any Rules deployment.**
   Must cover owner / dispatcher-logistic / master, master phone before/after unlock, review workflow, safe canonical delete and final Google parity.

3. **PIN-derived Firebase credential remains.**
   The candidate does not silently replace authentication without a migration plan for existing staff accounts.

4. **Google Bridge secret remains in the owner client trust boundary.**
   Removing it fully requires a server-side credential boundary.

5. **Apps Script has zero installable triggers.**
   Firestore is canonical and safe, but Google can lag while no owner coordinator session is open.

6. **Restore proof is incomplete.**
   Code rollback and Google snapshot exist; an isolated Firestore restore-and-compare is still required for full certification.

## Promotion policy

DO NOT merge/promote this branch until:
- final CI is green on candidate head;
- live owner authentication is available;
- current live rules are captured/backed up;
- candidate rules are deployed only with rollback available;
- authenticated role/browser smoke passes;
- data count/unique-ID parity is rechecked;
- one bounded technical E2E is run only if needed;
- no duplicate/self-growth/technical rows remain;
- restore/rollback path is documented and verified.

Until then:
- CURRENT remains `18.17.18-CURRENT`
- Candidate remains isolated.
