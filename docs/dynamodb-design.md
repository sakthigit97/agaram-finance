# DynamoDB design

## Table

The Serverless stack defines one `PAY_PER_REQUEST` table, `agaram-finance-${stage}`, with string keys `PK` and `SK`, server-side encryption, point-in-time recovery, and TTL on `expiresAt`. There are no scans in the application.

## Indexes and access-pattern justification

| Index | Partition key | Sort key | Required access pattern |
|---|---|---|---|
| Primary | `PK` | `SK` | Point-read profile/configuration; query one loan's ordered ledger; query one entity's audit trail; phone-to-user lookup; rate limit and idempotency keys. |
| GSI1 | `GSI1PK` | `GSI1SK` | Bounded daily collection/reversal ledger by business ID and business date. |
| GSI2 | `GSI2PK` | `GSI2SK` | Cursor-paginated business-wide customers, loans, staff, expenses, investments, and audit entries; date-keyed expenses/investments support bounded date-range queries. |
| GSI3 | `GSI3PK` | `GSI3SK` | Customer-owned loan list, scoped to one customer partition. |

All GSIs project `ALL` to support their documented response shapes without follow-up reads. Cursors are HMAC-signed with the API signing key and validated against the requested partition.

The current one-table layout stores each customer, loan, payment, and audit event as a separate keyed item; it is not one growing record. On-demand capacity, bounded queries, and pagination suit the current application without table scans. Before substantially increasing transaction volume, monitor consumed capacity, throttles, and per-key traffic: business-wide index partitions can become hot at high scale and may need a sharded index key with merged cursor pagination. Do not solve that by loading all records into the UI.

The current financial summary uses indexed, date-bounded queries and is limited to 366 days, but work still grows with the number of matching payment, expense, and investment entries. Before high-volume reporting, add sharded daily aggregate records (including audited reversal/edit adjustments) and backfill existing history; measure representative workloads rather than assuming on-demand billing removes latency limits.

## Item layout

| Item | `PK` | `SK` | Other attributes/index keys |
|---|---|---|---|
| User profile | `USER#<userId>` | `PROFILE` | Bcrypt hash, role, status, version. Never returned in API responses. |
| Phone mapping | `PHONE#<HMAC(normalizedPhone)>` | `USER` | User ID; separate SecureString key from JWT signing. |
| Customer profile | `CUSTOMER#<customerId>` | `PROFILE` | `GSI2PK=BUSINESS#<id>#CUSTOMERS`, custom values and their template snapshot. |
| Staff profile | `STAFF#<staffId>` | `PROFILE` | Human-readable, business-scoped sequential IDs use the `AGNT` prefix (for example `AGNT001`); `GSI2PK=BUSINESS#<id>#STAFF`. |
| Expense | `EXPENSE#<recordId>` | `PROFILE` | `GSI2PK=BUSINESS#<id>#EXPENSES`; date-keyed for range queries; each update has an audit event. |
| Investment contribution | `INVESTMENT#<recordId>` | `PROFILE` | `GSI2PK=BUSINESS#<id>#INVESTMENTS`; contributions are capital rather than earnings. |
| Loan profile | `LOAN#<loanId>` | `PROFILE` | `GSI2PK=BUSINESS#<id>#LOANS`, `GSI3PK=CUSTOMER#<customerId>#LOANS`; financial values in integer paise; schedule stored as a bounded nested plan. |
| Ledger entry | `LOAN#<loanId>` | `PAYMENT#<receivedAt>#<entryId>` | `GSI1PK=BUSINESS#<id>#DATE#<businessDate>`. Payment/reversal entries are append-only. |
| Payment locator | `PAYMENT#<paymentId>` | `PROFILE` | Resolves the ledger key without a table scan. |
| Reversal marker | `PAYMENT#<paymentId>` | `REVERSAL` | Enforces at most one reversal per payment. |
| Idempotency | `IDEMPOTENCY#<hash>` | `LOAN` or `PAYMENT` | Stores request hash and safe public response; rejects key reuse with a different request. |
| Audit event | `ENTITY#<entityType>#<entityId>` | `EVENT#<timestamp>#<eventId>` | `GSI2PK=BUSINESS#<id>#AUDIT`. No secrets in metadata. |
| Custom-field template | `BUSINESS#<id>` | `TEMPLATE#CUSTOMER` or `TEMPLATE#LOAN` | Active fields, retired definitions, version. |
| Business settings | `BUSINESS#<id>` | `SETTINGS` | Timezone and daily/weekly schedule defaults. |
| Login throttle | `LOGIN#<HMAC(phone, IP)>` | `MINUTE#<epochMinute>` | Atomic counter and TTL. |

## Integrity and consistency

- Customer creation writes the customer, user, unique phone mapping, and audit event in one transaction.
- Loan creation writes the loan, idempotency record, and audit event in a transaction and condition-checks the customer.
- Payments use optimistic loan versions and a DynamoDB transaction for balance update, ledger entry, payment locator, idempotency response, and audit event.
- Reversal uses a version-checked transaction, an immutable reversal entry, unique reversal marker, and audit event. The original payment is unchanged.
- List views use stable secondary-index order and signed, query-partition-bound cursors.

## Future closed-loan history retention

Do not enable TTL on payment, reversal, or audit ledger entries. They are financial records and the current `expiresAt` TTL is only for explicitly expiring operational records. If old closed-loan histories need to leave the hot table later, first define the applicable legal/accounting retention period, export immutable ledger entries to a durable archive with checksums and restore tests, and verify the archive before deleting any source entries. Keep the loan's balance and summary fields in the operational table; expose archived detail through a separately paginated read path. No archive or deletion job is enabled today.
