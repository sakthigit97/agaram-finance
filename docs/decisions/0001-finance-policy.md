# Decision 0001: initial finance policies

- Status: accepted for the first implementation foundation.
- Daily collection dates are calendar days and start the day after disbursement.
- Weekly collection dates begin seven days after disbursement, with ten expected instalments by default.
- Monthly interest is a fixed charge per complete monthly cycle, is not prorated, and payments apply to interest before principal.
- The first monthly interest charge becomes due at the first monthly anniversary.
- Monthly anniversary dates clamp to the last day of a shorter month.
- Financial calculations use integer paise.
- No penalties, holiday skips, or automatic expiry are introduced.
- Custom data fields are admin-defined, reusable text/number/boolean/date fields. Unknown fields and unapproved types are rejected, and removed field values remain in existing records.
- Customer/staff accounts use one-time temporary passwords; login requires a password change on first use.
- Payment corrections use append-only audited reversals.
