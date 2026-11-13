import { query, withTransaction } from '../db';
import { money } from '../money';
import { CreateInvoiceArgs } from '../types';
import { postJournalEntry, getAccountByCode, CODES } from './journal';
import { nextNumber } from '../numbering';

export async function _createInvoice(args: CreateInvoiceArgs, client: any): Promise<any> {
  const { partyId, invoiceType, issueDate, dueDate, lines, taxRateId = null } = args;
  const invoiceNumber = args.invoiceNumber || await nextNumber(client, 'invoice');

  const subtotal = lines.reduce((s, l) => s.plus(money(l.amount)), money(0));
  if (!subtotal.greaterThan(0)) throw new Error('Invoice subtotal must be positive.');

  let taxAmount = money(0);
  if (taxRateId) {
    const { rows } = await client.query('SELECT rate FROM tax_rates WHERE id = $1', [taxRateId]);
    if (rows.length) taxAmount = subtotal.times(money(rows[0].rate)).div(100).toDecimalPlaces(2);
  }
  const total = subtotal.plus(taxAmount);

  const inv = await client.query(
    'INSERT INTO invoices (invoice_number, party_id, invoice_type, issue_date, due_date, subtotal, tax_amount, total) VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8) RETURNING id',
    [invoiceNumber, partyId, invoiceType, issueDate, dueDate, subtotal.toFixed(2), taxAmount.toFixed(2), total.toFixed(2)],
  );
  const invoiceId = inv.rows[0].id;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const acct = await getAccountByCode(line.accountCode, client);
    await client.query(
      'INSERT INTO invoice_lines (invoice_id, description, account_id, quantity, unit_price, amount, tax_rate_id, line_no) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [invoiceId, line.description, acct.id, line.quantity || 1, line.unitPrice || 0, line.amount, taxRateId, i + 1],
    );
  }

  const entryLines: any[] = [];
  if (invoiceType === 'sale') {
    entryLines.push({ accountCode: CODES.AR, lineType: 'debit', amount: total.toFixed(2), partyId });
    for (const line of lines) entryLines.push({ accountCode: line.accountCode, lineType: 'credit', amount: line.amount, partyId });
    if (taxAmount.greaterThan(0)) entryLines.push({ accountCode: CODES.VAT_PAYABLE, lineType: 'credit', amount: taxAmount.toFixed(2), partyId });
  } else {
    entryLines.push({ accountCode: CODES.AP, lineType: 'credit', amount: total.toFixed(2), partyId });
    for (const line of lines) entryLines.push({ accountCode: line.accountCode, lineType: 'debit', amount: line.amount, partyId });
    if (taxAmount.greaterThan(0)) entryLines.push({ accountCode: CODES.VAT_PAYABLE, lineType: 'debit', amount: taxAmount.toFixed(2), partyId });
  }

  const entry = await postJournalEntry({
    date: issueDate,
    reference: invoiceNumber,
    description: `${invoiceType} invoice ${invoiceNumber}`,
    lines: entryLines,
  }, client);

  await client.query("UPDATE invoices SET journal_entry_id = $1, status = 'issued' WHERE id = $2", [entry.id, invoiceId]);

  return {
    invoiceId,
    invoiceNumber,
    subtotal: subtotal.toFixed(2),
    taxAmount: taxAmount.toFixed(2),
    total: total.toFixed(2),
    journalEntryId: entry.id,
  };
}

export async function createInvoice(args: CreateInvoiceArgs): Promise<any> {
  return withTransaction((client) => _createInvoice(args, client));
}

export async function getInvoice(id: number): Promise<any> {
  const { rows } = await query('SELECT * FROM invoices WHERE id = $1', [id]);
  return rows[0];
}
