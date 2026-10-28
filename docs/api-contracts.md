# API contracts (implemented)

The API returns JSON, rejects unknown core request fields, and reports errors in `{ "error": { "code", "message", "requestId" } }`.

## Authentication

- `GET /health`: public readiness check.
- `POST /auth/login`: `{ phone, password }`; `phone` must be a local ten-digit Indian mobile number without a country code. Returns a 24-hour bearer token and public user data. Login errors do not reveal whether the phone exists. Existing accounts stored with a legacy `+91` phone key remain accessible with the local ten-digit number.
- `GET /auth/me`: authenticated public account details.
- `POST /auth/password`: `{ currentPassword, newPassword }`; admin/agent accounts may change their own passwords, while customer accounts may only replace a temporary password on first sign-in.
- `POST /users/{userId}/password`: admin-only empty JSON object; generates and returns a one-time temporary password and forces a change at the next sign-in.
- `POST /staff`: admin-only `{ name, phone }`; `phone` must be a unique local ten-digit Indian mobile number without a country code. Returns a one-time temporary password.
- `GET /staff?limit=&cursor=`: admin-only, cursor-paginated agent list.
- `PATCH /staff/{staffId}`: admin-only `{ name?, phone? }`; updates the agent profile and matching login record, enforces phone uniqueness, and records the change in the audit log.
- Account creation and admin resets return unique, role-prefixed one-time credentials (for example `customer@Agaram-<unique-suffix>` or `agent@Agaram-<unique-suffix>`); each must be changed at first sign-in. These are not shared default passwords.

## Customers, loans, and payments

- `POST /customers`: admin/staff; `{ name, phone, area, address?, email?, notes?, customFields? }`. `phone` must be unique and use a local ten-digit Indian mobile number without a country code. New customer IDs are business-scoped, readable `CUS001`, `CUS002`, etc. Provisions a customer account and returns its initial password once.
- `GET /customers?limit=&cursor=`: admin/staff, cursor-paginated.
- `GET /customers/{customerId}`: customer ownership enforced.
- `PATCH /customers/{customerId}`: admin-only; updates customer profile fields and records before/after values in the audit log.
- `POST /loans`: admin/staff; requires `Idempotency-Key`. Core input includes `customerId`, `type`, `principalPaise`, and applicable interest/fee fields. New loan IDs are business-scoped `LOAN001`, `LOAN002`, etc. The backend calculates disbursement, collection target, and expected schedule.
- `GET /loans?limit=&cursor=`: admin/staff business list; customer role is scoped to its own loans.
- `GET /loans/{loanId}`: role and customer ownership checked.
- `PATCH /loans/{loanId}`: admin-only and audited. Financial terms are locked after any ledger transaction is posted; custom fields can still be updated.
- `POST /loans/{loanId}/payments`: admin/staff; requires `Idempotency-Key` and positive integer `amountPaise`; new transaction IDs are business-scoped `TRNS001`, `TRNS002`, etc. The server validates outstanding balance and calculates payment allocation.
- `GET /loans/{loanId}/payments?limit=&cursor=`: authorized payment history.
- `POST /loans/{loanId}/payments/{paymentId}/reverse`: admin-only append-only reversal.
- `PATCH /loans/{loanId}/payments/{paymentId}`: admin-only and audited; only the latest unreversed transaction can be edited, and its ID/date are immutable.
- `GET /collections?date=YYYY-MM-DD&limit=&cursor=`: admin/staff daily ledger view.

## Expenses, investments, and financial reports

- `GET /expenses?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=&cursor=`: admin/staff date-filtered, cursor-paginated expenses.
- `POST /expenses`: admin/staff `{ date, amountPaise, reason, comments?, agentId? }`; staff-created expenses are assigned to the signed-in agent. Admins may assign an active agent. Updates are audited.
- `PATCH /expenses/{recordId}`: admin/staff audited expense update.
- `GET /investments?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=&cursor=`: admin/staff date-filtered, cursor-paginated investor contributions.
- `POST /investments`: admin/staff `{ date, amountPaise, investorName, comments? }`; contributions represent funding capital, not revenue.
- `PATCH /investments/{recordId}`: admin/staff audited investment update.
- `GET /reports/summary?from=YYYY-MM-DD&to=YYYY-MM-DD`: admin-only report with selected-period activity, a daily cash-movement breakdown, and an all-time portfolio snapshot. Period activity includes collections, collected interest, principal repaid, expenses, investor capital, loan disbursements, and net cash movement. The portfolio snapshot includes total capital, total disbursements, current outstanding principal, total collections, interest, upfront interest, book fees, expenses, earnings, and calculated cash balance. Date ranges are limited to 366 days. Principal repayments and investor capital are not earnings. Calculated cash balance is capital plus collections less loan disbursements and recorded expenses.

## Settings, templates, audit

- `GET /settings`, `PATCH /settings`: admin-only business settings.
- `GET /settings/custom-fields?entityType=CUSTOMER|LOAN`: admin/staff form definitions.
- `PUT /settings/custom-fields/{customer|loan}`: admin-only `{ fields: [{ key, label, type, required }] }`.
- `GET /staff?limit=&cursor=`: admin-only staff list.
- `GET /audit?limit=&cursor=` or `GET /audit?entityType=&entityId=&limit=&cursor=`: admin-only.

Custom field values are sent as a `customFields` object and must match the active template. Supported value types are text, finite number, boolean, and ISO date. For admin updates, send `null` for an optional field to clear it; required fields cannot be cleared. Undeclared fields, nested values, and reserved core field names are rejected. Retired custom values remain stored with their original field definitions.

The local React UI is connected to these routes through `src/lib/api.ts`. It stores the access token in tab-scoped `sessionStorage` so a page refresh can restore the session, and revalidates it with `/auth/me` before loading protected data. Successful GET responses are cached in memory for 15 seconds and concurrent identical requests are deduplicated; successful writes invalidate the cache. It sends the required idempotency keys for loan/payment writes, paginates lists with signed cursors, and uses typed template definitions to render custom inputs. Operational lists display the current server page; the financial summary is aggregated server-side for the selected date range.
