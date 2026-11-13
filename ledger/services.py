"""
Business-logic service layer for the accounting system.

These functions encapsulate the accounting rules so that views, admin actions,
and management commands share one correct implementation:

  * every journal entry must balance (debits == credits)
  * issuing an invoice automatically posts its journal entry
  * recording a payment allocates it to invoices and posts its entry

All multi-step operations run inside a database transaction. The database's
triggers (balanced entries, immutable posted entries) remain the final guard.
"""
from decimal import Decimal, ROUND_HALF_UP

from django.db import transaction
from django.db.models import Sum

from .models import (
    Account,
    FiscalPeriod,
    Invoice,
    InvoiceLine,
    InvoicePayment,
    JournalEntry,
    JournalEntryLine,
    Payment,
)

# Standard account codes (from the seeded chart of accounts)
CASH = '1000'
BANK = '1005'
MOBILE_MONEY = '1010'
AR = '1100'
AP = '2000'
VAT_PAYABLE = '2100'

# Which asset account a payment method hits
PAYMENT_ACCOUNTS = {
    Payment.Method.CASH: CASH,
    Payment.Method.BANK: BANK,
    Payment.Method.MOBILE_MONEY: MOBILE_MONEY,
    Payment.Method.OTHER: BANK,
}


def _account(code):
    return Account.objects.get(code=code)


def _round2(value):
    return value.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def post_journal_entry(date, reference, description, lines, idempotency_key=None):
    """
    Create and post a balanced journal entry atomically.

    ``lines`` is a list of dicts::

        {'account': Account, 'line_type': 'debit'|'credit',
         'amount': Decimal, 'party': Party | None}

    ``idempotency_key`` is an optional client-supplied unique key: if an entry
    with that key already exists it is returned unchanged (no double-posting).
    """
    if not lines:
        raise ValueError('A journal entry needs at least one line.')

    total_debit = sum((l['amount'] for l in lines if l['line_type'] == 'debit'), Decimal('0'))
    total_credit = sum((l['amount'] for l in lines if l['line_type'] == 'credit'), Decimal('0'))

    if total_debit == 0:
        raise ValueError('A journal entry cannot have zero amounts.')
    if total_debit != total_credit:
        raise ValueError(
            f'Journal entry is not balanced: debits {total_debit} != credits {total_credit}.'
        )

    if FiscalPeriod.objects.filter(is_closed=True, start_date__lte=date, end_date__gte=date).exists():
        raise ValueError(f'Period {date} is closed for posting.')

    with transaction.atomic():
        if idempotency_key:
            existing = JournalEntry.objects.filter(idempotency_key=idempotency_key).first()
            if existing:
                return existing

        entry = JournalEntry.objects.create(
            entry_date=date, reference=reference, description=description,
            idempotency_key=idempotency_key,
        )
        for i, line in enumerate(lines, start=1):
            JournalEntryLine.objects.create(
                journal_entry=entry,
                account=line['account'],
                line_type=line['line_type'],
                amount=line['amount'],
                line_no=i,
                party=line.get('party'),
            )
        entry.status = JournalEntry.Status.POSTED  # DB trigger re-checks balance
        entry.save()
    return entry


def create_invoice(invoice_number, party, invoice_type, issue_date, due_date, lines, tax_rate=None):
    """
    Create an invoice with line items, post its journal entry, and mark it issued.

    ``lines`` is a list of dicts::

        {'description': str, 'account': Account, 'quantity': Decimal,
         'unit_price': Decimal, 'amount': Decimal}
    """
    if invoice_type not in (Invoice.Type.SALE, Invoice.Type.PURCHASE):
        raise ValueError(f'Unknown invoice type: {invoice_type}')

    subtotal = sum((l['amount'] for l in lines), Decimal('0'))
    if subtotal <= 0:
        raise ValueError('Invoice subtotal must be positive.')

    tax_amount = _round2(subtotal * tax_rate.rate / 100) if tax_rate else Decimal('0')
    total = subtotal + tax_amount

    with transaction.atomic():
        invoice = Invoice.objects.create(
            invoice_number=invoice_number,
            party=party,
            invoice_type=invoice_type,
            issue_date=issue_date,
            due_date=due_date,
            subtotal=subtotal,
            tax_amount=tax_amount,
            total=total,
        )
        for i, line in enumerate(lines, start=1):
            InvoiceLine.objects.create(
                invoice=invoice,
                description=line['description'],
                account=line['account'],
                quantity=line['quantity'],
                unit_price=line['unit_price'],
                amount=line['amount'],
                tax_rate=tax_rate,
                line_no=i,
            )

        entry = post_journal_entry(
            issue_date,
            invoice_number,
            f'{Invoice.Type(invoice_type).label} invoice {invoice_number} to {party.name}',
            _invoice_entry_lines(invoice, lines, tax_amount),
        )

        invoice.journal_entry = entry
        invoice.status = Invoice.Status.ISSUED
        invoice.save()
    return invoice


def _invoice_entry_lines(invoice, lines, tax_amount):
    """Build the balanced debit/credit lines for an invoice posting."""
    party = invoice.party
    if invoice.invoice_type == Invoice.Type.SALE:
        entry_lines = [
            {'account': _account(AR), 'line_type': 'debit', 'amount': invoice.total, 'party': party},
        ]
        for line in lines:
            entry_lines.append({
                'account': line['account'], 'line_type': 'credit',
                'amount': line['amount'], 'party': party,
            })
        if tax_amount:
            entry_lines.append({
                'account': _account(VAT_PAYABLE), 'line_type': 'credit',
                'amount': tax_amount, 'party': party,
            })
    else:  # purchase
        entry_lines = [
            {'account': _account(AP), 'line_type': 'credit', 'amount': invoice.total, 'party': party},
        ]
        for line in lines:
            entry_lines.append({
                'account': line['account'], 'line_type': 'debit',
                'amount': line['amount'], 'party': party,
            })
        if tax_amount:
            entry_lines.append({
                'account': _account(VAT_PAYABLE), 'line_type': 'debit',
                'amount': tax_amount, 'party': party,
            })
    return entry_lines


def record_payment(payment_date, party, direction, amount, method=Payment.Method.BANK,
                   reference='', allocations=None):
    """
    Record a payment, post its journal entry, and (optionally) allocate it to invoices.

    ``allocations`` is an optional list of dicts::

        {'invoice': Invoice, 'amount': Decimal}
    """
    amount = Decimal(amount)
    if amount <= 0:
        raise ValueError('Payment amount must be positive.')
    if direction not in (Payment.Direction.INCOMING, Payment.Direction.OUTGOING):
        raise ValueError(f'Unknown payment direction: {direction}')

    asset_account = _account(PAYMENT_ACCOUNTS.get(method, BANK))

    if direction == Payment.Direction.INCOMING:
        entry_lines = [
            {'account': asset_account, 'line_type': 'debit', 'amount': amount, 'party': party},
            {'account': _account(AR), 'line_type': 'credit', 'amount': amount, 'party': party},
        ]
    else:
        entry_lines = [
            {'account': _account(AP), 'line_type': 'debit', 'amount': amount, 'party': party},
            {'account': asset_account, 'line_type': 'credit', 'amount': amount, 'party': party},
        ]

    with transaction.atomic():
        payment = Payment.objects.create(
            payment_date=payment_date,
            party=party,
            direction=direction,
            amount=amount,
            method=method,
            reference=reference,
        )
        entry = post_journal_entry(
            payment_date,
            reference or f'PAY-{payment.id}',
            f'Payment {"received from" if direction == Payment.Direction.INCOMING else "to"} {party.name}',
            entry_lines,
        )
        payment.journal_entry = entry
        payment.save()

        if allocations:
            for alloc in allocations:
                InvoicePayment.objects.create(
                    invoice=alloc['invoice'], payment=payment, amount=alloc['amount'],
                )
                _refresh_invoice_status(alloc['invoice'])
    return payment


def _refresh_invoice_status(invoice):
    """Mark an invoice paid once its allocations cover the full total."""
    allocated = InvoicePayment.objects.filter(invoice=invoice).aggregate(s=Sum('amount'))['s'] or Decimal('0')
    if allocated >= invoice.total:
        invoice.status = Invoice.Status.PAID
        invoice.save(update_fields=['status', 'updated_at'])


def get_trial_balance():
    """Return a list of {'code', 'name', 'type', 'debit', 'credit'} for posted entries."""
    from django.db.models import Case, DecimalField, Value, When

    rows = (
        JournalEntryLine.objects
        .filter(journal_entry__status=JournalEntry.Status.POSTED)
        .values('account__code', 'account__name', 'account__type')
        .annotate(
            debit=Sum(Case(
                When(line_type='debit', then='amount'),
                default=Value(0),
                output_field=DecimalField(max_digits=20, decimal_places=2),
            )),
            credit=Sum(Case(
                When(line_type='credit', then='amount'),
                default=Value(0),
                output_field=DecimalField(max_digits=20, decimal_places=2),
            )),
        )
        .order_by('account__code')
    )
    return [
        {
            'code': r['account__code'],
            'name': r['account__name'],
            'type': r['account__type'],
            'debit': r['debit'] or Decimal('0'),
            'credit': r['credit'] or Decimal('0'),
        }
        for r in rows
    ]


def reverse_entry(entry):
    """Create a reversing entry (swap debit/credit) for a posted entry."""
    if entry.status != JournalEntry.Status.POSTED:
        raise ValueError('Only posted entries can be reversed.')
    if JournalEntry.objects.filter(reversal_of=entry).exists():
        raise ValueError('Entry is already reversed.')

    lines = list(entry.lines.all())
    reverse_lines = [
        {
            'account': line.account,
            'line_type': 'credit' if line.line_type == 'debit' else 'debit',
            'amount': line.amount,
            'party': line.party,
        }
        for line in lines
    ]

    with transaction.atomic():
        reversal = post_journal_entry(
            entry.entry_date,
            f'REV-{entry.reference or entry.id}',
            f'Reversal of {entry.reference or entry.id}',
            reverse_lines,
        )
        reversal.reversal_of = entry
        reversal.save(update_fields=['reversal_of'])
    return reversal
