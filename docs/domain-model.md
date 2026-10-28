# Domain model (draft)

All money fields are integer paise. Timestamps are ISO 8601 UTC instants; business dates use ISO `YYYY-MM-DD` in the configured business timezone.

| Entity | Key fields | Notes |
|---|---|---|
| User | `userId`, normalized unique `phone`, `passwordHash`, `role`, `status`, `createdAt`, `version` | Roles are ADMIN, STAFF, CUSTOMER. Never return password hashes. |
| CustomerProfile | `customerId`, `userId`, `name`, `phone`, `area`, optional `address`/`email`/`notes`, `customFields`, `customFieldDefinitions`, `createdAt`, `updatedAt`, `version` | Customer creation provisions a login and returns a temporary password once. |
| StaffProfile | `staffId`, `userId`, `name`, `status`, custom-field values and definition snapshot | Linked to exactly one STAFF user. New staff IDs are sequential and human-readable (for example `AGNT001`). |
| Loan | `loanId`, `customerId`, `type`, exact integer paise fields, `schedule`, `customFields`, `customFieldDefinitions`, `disbursedOn`, optional `principalPaidOffOn`, `status`, `version` | Monthly interest is fixed per completed cycle and stops after principal is repaid. Daily/weekly schedule is stored with the loan and remains separate from the payment ledger. |
| Payment ledger entry | `paymentId`, `loanId`, `amountPaise`, component allocations, `receivedAt`, `receivedOn`, `receivedBy`, `method`, `balanceAfterPaise`, `entryType` | Original payments remain immutable. An audited reversal is a separate positive ledger entry with `entryType=REVERSAL`. |
| BusinessConfiguration | `businessId`, `name`, `timeZone`, `dailyDurationDays`, `weeklyInstallments`, `version` | Customer-specific configuration; no tenant forks. |
| CustomFieldTemplate | `businessId`, entity type, field key/label/type/required, version, retired definitions | Admin-managed reusable templates. Field types are text, number, boolean, and ISO date. Core fields cannot be shadowed. |
| AuditEvent | `eventId`, `actorUserId`, `action`, `entityType`, `entityId`, `occurredAt`, `requestId`, `metadata` | Append-only, metadata excludes secrets and unnecessary personal data. |

## DynamoDB physical layout

One on-demand, encrypted, point-in-time-recoverable table uses string `PK` and `SK` attributes.

- `GSI1`: business/date ledger lookup for daily collection views (`BUSINESS#<id>#DATE#<yyyy-mm-dd>`).
- `GSI2`: stable, cursor-paginated business lists partitioned by customers, loans, staff, or audit events.
- `GSI3`: customer-owned loan list, allowing customer routes to query only that customer's loans.
- Loan schedule is a bounded nested plan on the loan item (maximum 365 daily or 52 weekly entries); monthly schedules have no fixed end.
- Payments and reversal entries are partitioned by loan ID. Separate payment locators support direct reversal lookup.
- Phone lookups use an HMAC-derived partition key; the stable HMAC key is kept in AWS Systems Manager Parameter Store as a SecureString.

Index projections are `ALL` so list responses do not need extra reads. No general-purpose scan endpoint exists.

This is a draft logical model, not a deployed DynamoDB schema. Physical keys and indexes are gated on the access-pattern and transaction design.
