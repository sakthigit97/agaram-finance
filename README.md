# Agaram Finance

A finance-management application foundation for daily, weekly, and monthly lending workflows.

> **Frontend status:** the current frontend still displays sample data and is not connected to the authenticated API. Do not enter real customer information in the demo UI.

## Frontend

```powershell
npm install
npm run dev
npm run build
npm test
```

## Backend API

The AWS Serverless API is deployed in `ap-south-2`. Current health endpoint: [GET /health](https://iodyn33qxf.execute-api.ap-south-2.amazonaws.com/health).

The API implementation includes authentication, role enforcement, customer/staff/loan/payment routes, DynamoDB persistence, admin-defined custom-field templates, exact paise calculations, idempotent payment/loan writes, audit history, and append-only payment reversals.

See [API contracts](./docs/api-contracts.md), [DynamoDB design](./docs/dynamodb-design.md), and [deployment guide](./docs/deployment-guide.md).

The initial admin must be created with the local bootstrap script before authenticated API routes can be used. AWS credentials and secrets stay in your local AWS profile and Parameter Store; never paste them into source or chat.
