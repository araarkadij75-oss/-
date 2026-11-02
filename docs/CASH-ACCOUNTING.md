# Cash and profit consistency

Financial cash is collected through `collectRecordedCash` for analytics, cash drill-down, daily/trend charts, staff groups, Today cards and the profit adapter.

- A recorded receipt is a completed order or one with an explicit cash-closure marker.
- Positive company cash is counted independently of whether the total customer price is filled in.
- Linked duplicates and repeated order IDs are excluded. Arithmetic uses integer kopecks.
- Intake, visit and surrender dates are separate, strict bases. A missing date never falls back to another field.
- Confirmed undated cash belongs to its original intake cohort, but cannot be assigned a receipt day. Textual notes in the surrender field are not invented dates.
- Future or contradictory receipt dates are excluded. Payroll/profit display unresolved-data warnings.

The dashboard defaults to intake date. Its cash is equal to Finance/Avito intake cash when period and other filters agree. A visit-date operational view is not the same cohort. The profit shortcut preserves period and the matching financial date basis; profit is for the whole business, not a master/status subset.

The dashboard does not compute a second profit estimate from an unhydrated expense list. Finance/Avito owns net profit: company cash minus intake-day salary accruals minus active advertising and other expenses. Actual salary payments reduce the employee's outstanding balance, never profit a second time. Historical paid reports remain immutable credits.

Salary remains max(2000 RUB, 10% cumulative confirmed cash of the employee's own original intake-day orders). Late closure changes that original day's entitlement only by the incremental amount. A calendar entry alone is not evidence of a worked day.

Monthly Avito totals require the full source period; partial-period allocation is unknown. Duplicate identified expense operations are counted once; conflicting duplicates and malformed amounts/dates produce warnings. Refunds remain distinct operations.

Regression coverage: `cash-consistency`, `cross-module-accounting`, `profit-accounting`, `payroll-intake-accounting`, `analytics-cash-drill`, and full role/module gates. No source-order or paid-report migration accompanies this change.
