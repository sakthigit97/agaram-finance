# Business rules

## Confirmed policy decisions

- Currency is INR. Persisted and calculated values use integer paise.
- Daily and weekly loans collect the nominal loan amount. Upfront interest and an optional book fee reduce disbursement, not the collection target.
- Daily expected collections start the day after disbursement, are scheduled for every calendar day, and default to 90 expected days. This is informational; it never blocks a late or partial payment.
- Weekly loans default to 10 instalments. The first due date is seven days after disbursement. The schedule never blocks a late or partial payment.
- Neither daily nor weekly collections may exceed the remaining collection target; reject an overpayment rather than reducing it.
- Monthly loans use a fixed interest charge per complete monthly cycle, with no partial-month proration. Apply a payment to accrued interest first, then principal. Interest stops when principal is fully repaid.
- Monthly interest cycles use the disbursement day as the monthly anniversary; if a month does not contain that day, use that month's final calendar day.
- Monthly interest stops accruing on the business date the principal is fully repaid. Payment dates cannot be before disbursement or earlier than a prior ledger entry; dates are recorded in business-local `Asia/Kolkata` by default.
- Customer, loan, and agent extra fields come only from admin-defined templates. Template field types cannot be changed after first use; retiring a field does not remove historical values.
- New customer and staff accounts receive a one-time generated temporary password and must change it before using protected operations.
- Financial payment corrections are append-only reversals; original collection entries are never edited or deleted.

## Still requires a business decision before release

- Whether/when a recorded collection can be corrected or reversed. Do not edit or delete a financial ledger entry without an approved correction policy and audit trail.
- Data retention, customer consent, KYC, lending compliance, and jurisdiction-specific operational requirements.

No penalty, grace period, holiday rule, or automatic loan expiry is assumed.
