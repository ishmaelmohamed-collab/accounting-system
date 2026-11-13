import { withTransaction } from '../db';
import { money } from '../money';
import { postJournalEntry, CODES } from './journal';
import { nextNumber } from '../numbering';

async function _createNote(args: any, client: any): Promise<any> {
  const {
    partyId, noteType, issueDate, reason = null, invoiceId = null,
    subtotal: subtotalArg, taxRateId = null, noteNumber: noteNumberArg,
    accountCode = '4000',
  } = args;

  const subtotal = money(subtotalArg);
  if (!subtotal.isPositive()) throw new Error('Note subtotal must be positive.');

  let taxAmount = money(0);
  if (taxRateId) {
    const { rows } = await client.query('SELECT rate FROM tax_rates WHERE id = $1', [taxRateId]);
    if (rows.length) taxAmount = subtotal.times(money(rows[0].rate)).div(100).toDecimalPlaces(2);
  }
  const total = subtotal.plus(taxAmount);

  const noteNumber = noteNumberArg || await nextNumber(client, 'credit_note');

  const note = await client.query(
    `INSERT INTO credit_notes (note_number, party_id, note_type, issue_date, reason, invoice_id, subtotal, tax_rate_id, tax_amount, total)
     VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [noteNumber, partyId, noteType, issueDate, reason, invoiceId, subtotal.toFixed(2), taxRateId, taxAmount.toFixed(2), total.toFixed(2)],
  );
  const noteId = note.rows[0].id;

  // Credit note: credit AR (reduce owed), debit revenue + VAT (reverse).
  // Debit note: debit AR (increase owed), credit revenue + VAT.
  const lines: any[] = noteType === 'credit'
    ? [
        { accountCode: CODES.AR, lineType: 'credit', amount: total.toFixed(2), partyId },
        { accountCode, lineType: 'debit', amount: subtotal.toFixed(2), partyId },
      ]
    : [
        { accountCode: CODES.AR, lineType: 'debit', amount: total.toFixed(2), partyId },
        { accountCode, lineType: 'credit', amount: subtotal.toFixed(2), partyId },
      ];
  if (taxAmount.isPositive()) {
    lines.push(noteType === 'credit'
      ? { accountCode: CODES.VAT_PAYABLE, lineType: 'debit', amount: taxAmount.toFixed(2) }
      : { accountCode: CODES.VAT_PAYABLE, lineType: 'credit', amount: taxAmount.toFixed(2) });
  }

  const entry = await postJournalEntry({
    date: issueDate,
    reference: noteNumber,
    description: `${noteType} note ${noteNumber}${reason ? ` — ${reason}` : ''}`,
    lines,
  }, client);

  await client.query('UPDATE credit_notes SET journal_entry_id = $1 WHERE id = $2', [entry.id, noteId]);

  return { noteId, noteNumber, noteType, total: total.toFixed(2), journalEntryId: entry.id };
}

export async function createNote(args: any): Promise<any> {
  return withTransaction((client) => _createNote(args, client));
}
