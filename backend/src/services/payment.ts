import { query, withTransaction } from '../db';
import { RecordPaymentArgs } from '../types';
import { postJournalEntry, CODES } from './journal';

const PAYMENT_ACCOUNTS: Record<string, string> = {
  cash: CODES.CASH,
  bank: CODES.BANK,
  mobile_money: CODES.MOBILE_MONEY,
  other: CODES.BANK,
};

async function _recordPayment(args: RecordPaymentArgs, client: any): Promise<any> {
  const { paymentDate, partyId, direction, amount, method = 'bank', reference = '', allocations = [] } = args;

  const pay = await client.query(
    'INSERT INTO payments (payment_date, party_id, direction, amount, method, reference) VALUES ($1::date, $2, $3, $4, $5, $6) RETURNING id',
    [paymentDate, partyId, direction, amount, method, reference],
  );
  const paymentId = pay.rows[0].id;

  const assetCode = PAYMENT_ACCOUNTS[method] || CODES.BANK;
  let entryLines: any[];
  if (direction === 'incoming') {
    entryLines = [
      { accountCode: assetCode, lineType: 'debit', amount, partyId },
      { accountCode: CODES.AR, lineType: 'credit', amount, partyId },
    ];
  } else {
    entryLines = [
      { accountCode: CODES.AP, lineType: 'debit', amount, partyId },
      { accountCode: assetCode, lineType: 'credit', amount, partyId },
    ];
  }

  const entry = await postJournalEntry({
    date: paymentDate,
    reference: reference || `PAY-${paymentId}`,
    description: `Payment ${direction === 'incoming' ? 'received from' : 'to'} party ${partyId}`,
    lines: entryLines,
  }, client);

  await client.query('UPDATE payments SET journal_entry_id = $1 WHERE id = $2', [entry.id, paymentId]);

  for (const alloc of allocations) {
    await client.query(
      'INSERT INTO invoice_payments (invoice_id, payment_id, amount) VALUES ($1, $2, $3)',
      [alloc.invoiceId, paymentId, alloc.amount],
    );
    const paid = await client.query(
      'SELECT COALESCE(SUM(amount), 0) AS allocated FROM invoice_payments WHERE invoice_id = $1',
      [alloc.invoiceId],
    );
    const invoice = await client.query('SELECT total FROM invoices WHERE id = $1', [alloc.invoiceId]);
    if (invoice.rows.length && Number(paid.rows[0].allocated) >= Number(invoice.rows[0].total)) {
      await client.query("UPDATE invoices SET status = 'paid' WHERE id = $1", [alloc.invoiceId]);
    }
  }

  return { paymentId, journalEntryId: entry.id };
}

export async function recordPayment(args: RecordPaymentArgs): Promise<any> {
  return withTransaction((client) => _recordPayment(args, client));
}
