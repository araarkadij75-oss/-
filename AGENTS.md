# CRM development boundaries

- The deployable CRM lives in `hosted-snapshot/`. Its three role HTML pages are generated artifacts, not editable sources.
- Edit application code and screen fragments in `src/crm/`, then run `npm run build:crm`. Do not patch generated HTML directly or copy changes between role pages by hand.
- `src/crm/manifest.json` owns source units and the exact execution order for each role. `dependency-contract.json` records reviewed global and cross-domain references. Never refresh this contract just to silence an unexplained failure.
- Standalone Telegram, profit, quality-monitor and PHP integrations remain separately maintained under `hosted-snapshot/`; see `docs/CRM-MODULES.md` for their public boundaries.
- Before a release run module checks, architecture tests, the full unit suite, access-rule checks and the existing release gate. `npm run test:module -- <module>` is a focused development check, not a substitute for the release gate.
- Keep data migrations separate from structural refactoring. Do not change orders, paid reports, salary formulas, role permissions or source reconciliation as a side effect of moving code.
- Preserve role-specific variants. Common code belongs in a shared source unit only when its behavior is actually identical.
- Preserve the existing visual style unless the current task explicitly requests changing it.
