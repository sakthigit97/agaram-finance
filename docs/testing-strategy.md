# Testing strategy

- Frontend: strict TypeScript production build plus unit tests for money parsing and financial domain rules.
- Backend: strict TypeScript build, domain/service unit tests, handler contract tests, and integration tests against an isolated AWS test environment before release.
- Required invariants: integer paise only; no over-collection; monthly interest applied before principal; expected dates never block payments; duplicate payment requests are idempotent; customer ownership is checked on every protected read.
- No production feature is complete until calculation, authorization, validation, transaction, audit, and failure behavior have tests.
