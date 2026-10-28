# Requirements status

This repository is an initial implementation foundation, not a production-ready lending system.

## Implemented in the local UI

- Responsive admin workspace shell with overview, customer, loan, collection, and report views.
- Sample customer, loan, and payment records, clearly marked as demo data.
- Local form interactions for creating a demo customer, loan, and payment.
- Exact paise parsing and validation for the local demo interactions.
- Daily/weekly payment caps and monthly fixed-interest allocation to interest before principal.

## Implemented in the backend

- API Gateway router for login, current-user/password, customers, staff, loans, payments, collection lookup, business settings/custom-field templates, and audit-history endpoints.
- Single DynamoDB table with documented keyed access patterns and three justified GSIs; no table scans.
- Server-derived RBAC/ownership checks, phone normalization, bcrypt password hashes, short-lived signed access tokens, and login throttling.
- Strict request schemas, positive integer paise financial values, paginated list endpoints, signed pagination cursors, and idempotent loan/payment creation.
- Transactional payment recording with optimistic loan versions, monthly interest-first allocation, and append-only payment reversals.
- Admin-defined reusable custom-field templates, scalar/date value validation, strict unknown-field rejection, and historical custom-field schema retention.
- One-time first-admin bootstrap command that prompts for credentials without echoing the password.
- Public, data-free health endpoint and a deployed regional Serverless API.

## Not implemented; required before real financial use

- Customer login/portal screens, frontend API integration, pagination controls, record correction UI, and production reports.
- Backup restore drills, operational alarms, formal security review, jurisdiction-specific lending/legal review, and user acceptance testing.
- Do not enter or rely on real customer data in the frontend demo until it is connected to the authenticated API and the customer portal is complete.
