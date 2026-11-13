import { query } from '../db';
import { profitAndLoss } from '../reports';
import { postJournalEntry } from './journal';

const RETAINED_EARNINGS = '3100';

export async function closeYear(year: number): Promise<any> {
  const existing = await query('SELECT 1 FROM year_end_closures WHERE year = $1', [year]);
  if (existing.rows.length) throw new Error(`Year ${year} is already closed.`);

  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  const pnl = await profitAndLoss(start, end);

  if (pnl.revenue.length === 0 && pnl.expense.length === 0) {
    throw new Error(`Year ${year} has no revenue or expense activity to close.`);
  }

  const lines: any[] = [];
  for (const r of pnl.revenue) lines.push({ accountCode: r.code, lineType: 'debit', amount: r.amount.toFixed(2) });
  for (const e of pnl.expense) lines.push({ accountCode: e.code, lineType: 'credit', amount: e.amount.toFixed(2) });

  const netIncome = pnl.netIncome;
  if (netIncome.isPositive()) {
    lines.push({ accountCode: RETAINED_EARNINGS, lineType: 'credit', amount: netIncome.toFixed(2) });
  } else if (netIncome.isNegative()) {
    lines.push({ accountCode: RETAINED_EARNINGS, lineType: 'debit', amount: netIncome.abs().toFixed(2) });
  }

  const entry = await postJournalEntry({
    date: end,
    reference: `YE-${year}`,
    description: `Year-end close ${year}`,
    lines,
  });

  await query(
    'INSERT INTO year_end_closures (year, net_income, journal_entry_id) VALUES ($1, $2, $3)',
    [year, netIncome.toFixed(2), entry.id],
  );
  await query(
    'UPDATE fiscal_periods SET is_closed = TRUE WHERE start_date >= $1::date AND end_date <= $2::date',
    [start, end],
  );

  return { year, netIncome: netIncome.toFixed(2), journalEntryId: entry.id, closed: true };
}
