# Local development and deployment

## Tested toolchain

- Node.js 22.23.4 (also configured in `.nvmrc`)
- npm 11.6.2
- AWS Lambda runtime: `nodejs22.x`

## Frontend

From the repository root:

```powershell
npm install
npm run dev
npm run build
```

In development, Vite proxies `/api` to the deployed `ap-south-2` API so the local app can call it without broadening API CORS. The production frontend uses `VITE_API_URL`, which should be set to the API base URL during the later frontend deployment. The 24-hour access token is kept in tab-scoped `sessionStorage` to survive page refreshes, revalidated with `/auth/me` on startup, and cleared on sign-out or when expired.

The local UI supports login and forced password changes, customer and loan lists, collection-by-date, payment history for customer accounts, customer and agent management, expenses, investor capital records, date-range financial summaries, custom-field templates, business schedule settings, password resets, and audit history. Operational lists remain server-paginated. Financial reports query indexed records for the selected date range and are limited to 366 days; high-volume reporting will need sharded daily aggregates before scale.

## Backend

From `backend`, with the local `default` AWS CLI profile configured:

```powershell
npm install
$env:AWS_PROFILE = "default"
$env:AWS_REGION = "ap-south-2"
$env:STAGE = "dev"
# Production frontend origin. Do not include a trailing slash.
$env:ALLOWED_ORIGIN = "https://agaram-finance.vercel.app"
npm run build
npx serverless package --stage dev --region ap-south-2
npx serverless deploy --stage dev --region ap-south-2
npm run bootstrap:admin
```

Before deploying a new stage/account, create random, separate JWT-signing and phone-lookup secrets as SSM SecureString parameters named `/agaram-finance/<stage>/JWT_SECRET` and `/agaram-finance/<stage>/PHONE_LOOKUP_SECRET`. Generate/store them locally with a secret manager or a secure terminal workflow; do not commit them or pass them as command-line text. Lambda and the local bootstrap command need `ssm:GetParameter`; the Lambda execution role is scoped to those two parameter ARNs. The existing `dev` parameters were rotated after an earlier package exposed their previous values; the current deployment reads them at runtime and does not embed secret values in its templates.

Deploying the expanded stack creates API Gateway, Lambda, a pay-per-request DynamoDB table, three GSIs, CloudWatch logs, and a scoped IAM policy. The table enables point-in-time recovery and encryption at rest. The first-admin script securely prompts for the phone and password; the password is not echoed, stored in plaintext, or returned. It can run only once for a business.

The expanded `dev` API is deployed at `https://iodyn33qxf.execute-api.ap-south-2.amazonaws.com`. Its `GET /health` and browser CORS preflight have been verified. The initial admin has not yet been bootstrapped; run `npm run bootstrap:admin` from `backend` in an interactive PowerShell terminal using the configured `default` profile. To deploy to another account later, select a different local AWS CLI profile and create independent SSM secrets in that account; do not reuse the first account's phone-lookup secret because it determines phone-index keys.

The frontend is local-only; no frontend resources are deployed to AWS. Complete authenticated smoke tests after the first admin has been bootstrapped. Do not use synthetic production records for load testing without a separate explicit approval.
