# Intake-day payroll

The owner-approved rule is `max(2000 RUB, 10% of surrendered company cash)` for each employee's original intake day. A late receipt increases that same day's cumulative entitlement. It never creates another daily minimum or increases the threshold base of the receipt day.

`payroll-intake-accounting.js` is a pure integer-kopeck calculator. `payrollIntakeSnapshot` adapts CRM orders, the working schedule and immutable reports. Orders are deduplicated by ID and linked copies are excluded. The cash of previously accounted orders remains in its intake cohort; payments, rather than whole orders, are subtracted once from employee entitlement.

The owner confirmed that all existing confirmed reports were paid. The fixed cutover is the verified backup timestamp, 2026-11-02T10:59:27.607Z. Only owner-confirmed accounting reports closed by that cutover are treated as legacy payments. Later report confirmations do not imply payment. No money transfer is performed and no paid report is rewritten. The balance covers the configured schedule anchor through the calculation cutoff; the current working day remains in progress until the two-day cycle ends.

Confirmed closed cash with an unknown surrender date contributes to current intake-cohort entitlement only with current observation evidence. Its date is left blank. Cash-period expense timing remains unresolved and is reported explicitly. Old report IDs prove accounting, not a cash receipt date; they must not be copied into order dates.

Profit on the intake basis deducts cumulative intake-day entitlement once. Profit on the cash basis uses daily minimum and marginal late-accrual events, with warnings for undated increments. Paid salary is debt settlement and is not deducted a second time.

Legacy v1 report verification retains its historical calculation so paid report integrity remains reviewable. New draft creation uses intake entitlement and skips existing accounting reports. Month/person filters affect the displayed day/cycle breakdown; the full employee balance stays visible separately.

Module dependency review: the adapter reads core date/money/state helpers and the existing payroll ownership/schedule functions. Bootstrap explicitly injects the adapter into the optional profit module. UI renders only the adapter result. No new permissions, credentials, access-rule exceptions or order migrations are part of the release.

## Payment and workday audit (2026-11-03)

A planned calendar date is not evidence that a shift was worked. Intake orders of any status or an accounting report establish the employee/day. Explicitly closing or confirming an empty worked day establishes its minimum; merely opening a page does not. New intake report hashes use `intake-v2:`; historical unprefixed reports retain their historical validation.

New actual payments are recorded separately through owner-authenticated `finance.php` operations `payroll_payments_list`, `payroll_payments_add`, and `payroll_payments_void`. These record previously handed-over money; they do not transfer funds. Records require a unique reference, an idempotency key, an explicit exclusion of already recorded legacy payments, and a date on/after 2026-11-02. Server transactions serialize mutations and preserve an audit trail. Direct Firestore client access is denied. Missing payment data makes the remaining balance unknown, never zero. Accrued profit does not depend on payment-ledger availability.

Dependency review for this audit: the owner payment form uses the existing authenticated cloud token provider and same-origin finance endpoint, browser FormData/crypto/fetch, and core state. Shift confirmation adds a reviewed explicit-workday argument and existing currentUser/today helpers. No order or historical-report values are migrated by these code changes.
