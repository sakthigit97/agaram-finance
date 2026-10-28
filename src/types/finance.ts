export type LoanType = 'Daily' | 'Weekly' | 'Monthly'
export type LoanStatus = 'Active' | 'Paid'

export interface Customer {
  id: string
  name: string
  phone: string
  area: string
  joinedOn: string
  userId?: string
  address?: string
  email?: string
  notes?: string
  customFields?: Record<string, string | number | boolean>
}

export interface Loan {
  id: string
  customerId: string
  type: LoanType
  principalPaise: number
  interestPaise: number
  feePaise: number
  targetPaise: number
  collectedPaise: number
  interestCollectedPaise: number
  principalCollectedPaise: number
  disbursedOn: string
  status: LoanStatus
  customFields?: Record<string, string | number | boolean>
  schedule?: {
    kind: 'FIXED'
    count: number
    installments: { dueDate: string; expectedAmountPaise: number }[]
  } | {
    kind: 'MONTHLY'
    firstDueDate: string
  }
}

export interface Payment {
  id: string
  loanId: string
  amountPaise: number
  interestComponentPaise: number
  principalComponentPaise: number
  receivedOn: string
  method: 'Cash' | 'UPI' | 'Bank transfer' | 'Cheque'
  entryType?: 'PAYMENT' | 'REVERSAL'
  reversedPaymentId?: string
}

export type FinanceAction = 'customer' | 'loan' | 'payment' | 'staff'
