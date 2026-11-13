import { query, withTransaction } from '../db';
import { money } from '../money';
import { postJournalEntry } from './journal';

const PREPAID = '1400';

export async function createPrepayment(args: any): Promise<any> {
  const { description, accountCode, totalAmount, months, startDate } = args;
  return withTransaction(async (client) => {
    const r = await client.query(
      'INSERT INTO prepayments (description, account_code, total_amount, months, start_date) VALUES ($1,$2,$3,$4,$5::date) RETURNING id',
      [description, accountCode, totalAmount, months, startDate],
    );
    const entry = await postJournalEntry({
      date: startDate,
      reference: `PREPAY-${r.rows[0].id}`,
      description: `Prepayment: ${description}`,
      lines: [
        { accountCode: PREPAID, lineType: 'debit', amount: totalAmount },
        { accountCode: '1005', lineType: 'credit', amount: totalAmount },
      ],
    }, client);
    return { prepaymentId: r.rows[0].id, description, journalEntryId: entry.id };
  });
}

export async function amortizePrepayments(asOfDate: string): Promise<any[]> {
  const rows = (await query('SELECT * FROM prepayments ORDER BY id')).rows;
  const posted: any[] = [];
  for (const p of rows) {
    const totalAmount = money(p.total_amount);
    const months = Number(p.months);
    const monthly = totalAmount.div(months).toDecimalPlaces(2);
    const start = new Date(p.start_date);
    const asOf = new Date(asOfDate);
    const monthsElapsed = Math.max(0, Math.floor((asOf.getTime() - start.getTime()) / (365.25 * 86400000 / 12)));
    const due = Math.min(months, monthsElapsed);
    const already = Number(p.amortized_months);
    if (due > already) {
      const extra = due - already;
      const amount = monthly.times(extra).toDecimalPlaces(2);
      const entry = await postJournalEntry({
        date: asOfDate,
        reference: `AMORT-${p.id}`,
        description: `Amortization of ${p.description} (${extra} month(s))`,
        lines: [
          { accountCode: p.account_code, lineType: 'debit', amount: amount.toFixed(2) },
          { accountCode: PREPAID, lineType: 'credit', amount: amount.toFixed(2) },
        ],
      });
      await query('UPDATE prepayments SET amortized_months = $1 WHERE id = $2', [due, p.id]);
      posted.push({
        prepaymentId: p.id,
        description: p.description,
        monthsRecognized: extra,
        amount: amount.toFixed(2),
        journalEntryId: entry.id,
      });
    }
  }
  return posted;
}
