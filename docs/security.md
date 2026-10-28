# Security status

- The unauthenticated health route returns only service readiness.
- API Gateway CORS uses an explicitly configured origin; wildcard CORS is not enabled.
- Passwords are bcrypt-hashed. Login responses contain 24-hour bearer tokens; the frontend keeps the access token in tab-scoped `sessionStorage` and revalidates it with `/auth/me` after refresh.
- JWT signing and phone-lookup HMAC secrets are separate SSM SecureString parameters fetched by the Lambda at runtime and cached in memory; secret values are not included in deployment templates or committed.
- Each login checks a per-phone/IP minute bucket. Five attempts per minute are allowed before a 429 response.
- Customer and loan APIs validate extra values against admin-maintained templates. Unknown keys/types and reserved core names are rejected.
- Payment writes use integer paise, idempotency keys, optimistic version checks, and DynamoDB transactions. Payment reversal appends a separate entry and audit event.
- Expense and investment writes are admin/agent-only and audited. Financial reports are admin-only; investor contributions are reported separately from earnings.
- IAM is restricted to the application table and its indexes, plus `ssm:GetParameter` on the two runtime secret parameters. The API does not use DynamoDB scans.
- The frontend is API-integrated, but authenticated live workflows and production rollout requirements must be validated before treating it as production-ready.

Before production: complete the UI integration and customer portal, perform a security review and restore drill, validate jurisdiction-specific compliance and collection practices, configure monitoring/alarms, and review the allowed production frontend origin.
