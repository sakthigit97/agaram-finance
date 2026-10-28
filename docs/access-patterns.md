# Access patterns (initial)

These patterns are served with keyed DynamoDB reads/queries. No ordinary operation uses `Scan`.

1. Find a user by normalized unique phone for login.
2. Read a customer profile by customer ID.
3. List customers in stable, cursor-paginated order.
4. List loans by customer ID, newest first.
5. Read one loan by loan ID.
6. List payments for a loan in chronological order.
7. List collection activity for a business date.
8. List due schedule entries for a business date or bounded date range.
9. Read business configuration by business ID.
10. Read audit events globally within one business or for a single entity.
11. Resolve an immutable payment ID to its loan/ledger key for payment reversal.
12. Enforce unique normalized phone numbers using an HMAC-keyed phone lookup record.
13. List expenses and investor contributions for bounded date ranges using `GSI2` date-sort keys.
14. Aggregate collection, expense, and investment totals for an admin-selected date range without table scans.

`GSI1` supports collection and reversal entries by business date. `GSI2` supports customer, staff, loan, expense, investment, and audit lists by business partition; expenses and investments use date-prefixed sort keys. `GSI3` supports customer-owned loan listings. All list routes use bounded page sizes and signed cursors. Date-range financial summaries are limited to 366 days and aggregate all matching indexed entries, so report latency still grows with the number of records.
