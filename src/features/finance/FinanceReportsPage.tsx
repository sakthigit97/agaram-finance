import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { ChartNoAxesCombined } from 'lucide-react'
import { formatMoney, getBusinessDate } from '../../lib/format'
import type { FinanceReportSummary } from '../../lib/api'

export function FinanceReportsPage({ onLoad }: {
  onLoad: (from: string, to: string) => Promise<FinanceReportSummary>
}) {
  const today = getBusinessDate()
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`)
  const [to, setTo] = useState(today)
  const initialRange = useRef({ from, to })
  const [summary, setSummary] = useState<FinanceReportSummary | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (start: string, end: string) => {
    setLoading(true)
    setError('')
    try {
      setSummary(await onLoad(start, end))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Reports could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [onLoad])

  useEffect(() => {
    void load(initialRange.current.from, initialRange.current.to)
  }, [load])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (from > to) {
      setError('The start date must be on or before the end date.')
      return
    }
    void load(from, to)
  }

  return (
    <div className="page-wrap">
      <header className="topbar"><div className="breadcrumb"><span>Workspace</span><span className="crumb-separator">/</span><strong>Reports</strong></div></header>
      <section className="welcome-row section-welcome">
        <div><div className="eyebrow">FINANCIAL PERFORMANCE</div><h1>Reports</h1><p className="page-subtitle">Review collected repayments, interest earned, expenses, and investor capital by date range.</p></div>
      </section>
      <section className="panel report-filter-panel">
        <form className="report-date-form" onSubmit={submit}>
          <label className="form-field">From date<input type="date" value={from} max={to} required onChange={(event) => setFrom(event.target.value)} /></label>
          <label className="form-field">To date<input type="date" value={to} min={from} max={today} required onChange={(event) => setTo(event.target.value)} /></label>
          <button className="button button-primary" disabled={loading}>{loading ? 'Loading…' : 'Run report'}</button>
        </form>
        {error && <div className="form-error records-page-error" role="alert">{error}</div>}
      </section>
      {summary && <>
        <p className="report-period-note">Period: {summary.from} to {summary.to} · {summary.paymentCount} payments · {summary.expenseCount} expenses · {summary.investmentCount} capital contributions</p>
        <h2 className="section-title">Activity for this period</h2>
        <section className="report-metric-grid" aria-label="Financial results">
          <ReportMetric label="Net collections" value={summary.collectionsPaise} detail="Repayments less reversals" />
          <ReportMetric label="Interest earned" value={summary.interestEarnedPaise} detail="Interest component collected, less reversals" />
          <ReportMetric label="Principal repaid" value={summary.principalRepaidPaise} detail="Principal component collected, less reversals" />
          <ReportMetric label="Expenses" value={-summary.expensesPaise} detail="Recorded business expenses" />
          <ReportMetric label="Net earnings" value={summary.netEarningsPaise} detail="Collected interest less expenses" highlight />
          <ReportMetric label="Investor capital received" value={summary.investmentsPaise} detail="Funding, not revenue or profit" />
          <ReportMetric label="Loan money disbursed" value={-summary.disbursedPaise} detail="Cash given to borrowers in this period" />
          <ReportMetric label="Net cash movement" value={summary.netCashMovementPaise} detail="Capital + collections − disbursements − expenses" />
        </section>
        {summary.portfolio && <><h2 className="section-title">Overall portfolio position</h2>
        <section className="report-metric-grid" aria-label="Overall portfolio position">
          <ReportMetric label="Total investor capital" value={summary.portfolio.totalInvestorCapitalPaise} detail={`${summary.portfolio.totalInvestmentCount} recorded contributions`} />
          <ReportMetric label="Total loan money disbursed" value={summary.portfolio.totalDisbursedPaise} detail={`${summary.portfolio.loanCount} loans created`} />
          <ReportMetric label="Money currently with borrowers" value={summary.portfolio.outstandingPrincipalPaise} detail={`${summary.portfolio.activeLoanCount} active loans; principal still unpaid`} />
          <ReportMetric label="Total collections" value={summary.portfolio.totalCollectionsPaise} detail="All repayments received, net of reversals" />
          <ReportMetric label="Interest collected" value={summary.portfolio.totalInterestCollectedPaise} detail="Interest actually received through repayments" />
          <ReportMetric label="Upfront interest and fees" value={summary.portfolio.upfrontInterestPaise + summary.portfolio.bookFeesPaise} detail="Amounts withheld when qualifying loans were disbursed" />
          <ReportMetric label="Total expenses" value={-summary.portfolio.totalExpensesPaise} detail={`${summary.portfolio.totalExpenseCount} recorded expenses`} />
          <ReportMetric label="Overall earnings" value={summary.portfolio.totalEarningsPaise} detail="Interest + upfront interest + fees − expenses" highlight />
          <ReportMetric label="Calculated cash balance" value={summary.portfolio.calculatedCashBalancePaise} detail="Capital + collections − disbursements − expenses" highlight />
        </section>
        <section className="panel report-explanation"><ChartNoAxesCombined size={18} /><p>Calculated cash balance shows the money that should remain in the business from recorded capital, repayments, disbursements, and expenses. Principal repayments are recycled cash, not earnings.</p></section>
        <h2 className="section-title">Daily movement</h2>
        <div className="panel table-scroll"><table><thead><tr><th>Date</th><th>Capital in</th><th>Collections</th><th>Interest</th><th>Loan money out</th><th>Expenses</th><th>Net cash movement</th></tr></thead><tbody>{(summary.daily ?? []).map((day) => <tr key={day.date}><td>{day.date}</td><td>{formatMoney(day.investmentsPaise)}</td><td>{formatMoney(day.collectionsPaise)}</td><td>{formatMoney(day.interestEarnedPaise)}</td><td>{formatMoney(day.disbursedPaise)}</td><td>{formatMoney(day.expensesPaise)}</td><td>{formatMoney(day.netCashMovementPaise)}</td></tr>)}</tbody></table></div></>}
      </>}
    </div>
  )
}

function ReportMetric({ label, value, detail, highlight = false }: {
  label: string
  value: number
  detail: string
  highlight?: boolean
}) {
  return <article className={`metric-card report-result-card${highlight ? ' report-result-highlight' : ''}`}>
    <div className="metric-top"><span>{label}</span></div>
    <strong className="metric-value">{formatMoney(Math.abs(value))}{value < 0 ? ' debit' : ''}</strong>
    <p className="metric-bottom">{detail}</p>
  </article>
}
