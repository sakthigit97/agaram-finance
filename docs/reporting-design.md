# Reporting design

The reports page receives server-side calculations. It shows selected-period activity and a daily breakdown, plus an all-time portfolio snapshot. It does not calculate authoritative totals from the browser's loaded lists.

The calculated cash balance is `investor capital + repayments collected - cash disbursed for loans - recorded expenses`. It is accurate only when every capital contribution, loan disbursement, repayment, reversal, and expense is recorded in the application. Principal repayments are available cash for re-lending, not earnings. Overall earnings are collected interest plus upfront interest and book fees, less recorded expenses.

The current all-time snapshot reads the indexed loan, investment, and expense records. Before high-volume reporting, replace those full-history reads with sharded, reconciled daily and lifetime aggregate records, including reversal and edit adjustments. Do not use DynamoDB scans or browser totals as authoritative.
