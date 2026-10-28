# Authorization matrix (planned)

| Capability | ADMIN | STAFF | CUSTOMER |
|---|---:|---:|---:|
| Manage customers | Yes | Yes | Own profile only |
| Create loans | Yes | Yes | No |
| Record collections | Yes | Yes | No |
| View reports | Yes | No | No |
| Manage staff/business settings | Yes | No | No |
| Read loan/payment history | Authorized business records | Work-permitted records | Own records only |
| Correct/reverse a payment | Not enabled | Not enabled | No |

The implemented API enforces these permissions server-side. API tokens contain signed claims, and the current user role/status is reloaded from the user table for protected requests. Password-change-required accounts can only read `/auth/me` or change their password. The matrix does not imply customer portal screens are complete.
