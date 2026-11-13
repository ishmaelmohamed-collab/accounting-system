"""Financial reports: Profit & Loss and Balance Sheet.

Reports are computed from posted journal entries only, using each account's
normal balance to present debit/credit accounts as positive amounts.
"""
from decimal import Decimal

from django.db.models import Case, DecimalField, Sum, Value, When
from django.utils import timezone

from .models import Account, Budget, Invoice, InvoicePayment, JournalEntry, JournalEntryLine, Payment


def _account_balances(start_date=None, end_date=None):
    """Return {account_id: {'debit': Decimal, 'credit': Decimal}} for posted entries."""
    qs = JournalEntryLine.objects.filter(journal_entry__status='posted')
    if start_date:
        qs = qs.filter(journal_entry__entry_date__gte=start_date)
    if end_date:
        qs = qs.filter(journal_entry__entry_date__lte=end_date)

    rows = qs.values('account_id').annotate(
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
    return {
        r['account_id']: {
            'debit': r['debit'] or Decimal('0'),
            'credit': r['credit'] or Decimal('0'),
        }
        for r in rows
    }


def profit_and_loss(start_date=None, end_date=None):
    """Revenue minus expenses over a period."""
    balances = _account_balances(start_date, end_date)
    accounts = Account.objects.filter(type__in=['revenue', 'expense'], is_active=True).order_by('code')

    revenue, expense = [], []
    total_revenue = Decimal('0')
    total_expense = Decimal('0')

    for account in accounts:
        b = balances.get(account.id)
        if not b:
            continue
        if account.type == 'revenue':
            amount = b['credit'] - b['debit']
            if amount:
                revenue.append({'account': account, 'amount': amount})
                total_revenue += amount
        else:
            amount = b['debit'] - b['credit']
            if amount:
                expense.append({'account': account, 'amount': amount})
                total_expense += amount

    return {
        'start_date': start_date,
        'end_date': end_date,
        'revenue': revenue,
        'expense': expense,
        'total_revenue': total_revenue,
        'total_expense': total_expense,
        'net_income': total_revenue - total_expense,
    }


def balance_sheet(as_of_date=None):
    """Assets = Liabilities + Equity (including current-period net income)."""
    balances = _account_balances(end_date=as_of_date)
    accounts = Account.objects.filter(type__in=['asset', 'liability', 'equity'], is_active=True).order_by('code')

    assets, liabilities, equity = [], [], []
    total_assets = Decimal('0')
    total_liabilities = Decimal('0')
    total_equity = Decimal('0')

    for account in accounts:
        b = balances.get(account.id)
        if not b:
            continue
        if account.type == 'asset':
            amount = b['debit'] - b['credit']
            if amount:
                assets.append({'account': account, 'amount': amount})
                total_assets += amount
        elif account.type == 'liability':
            amount = b['credit'] - b['debit']
            if amount:
                liabilities.append({'account': account, 'amount': amount})
                total_liabilities += amount
        else:  # equity
            amount = b['credit'] - b['debit']
            if amount:
                equity.append({'account': account, 'amount': amount})
                total_equity += amount

    # Revenue and expense accounts are not closed, so their net movement to
    # date is effectively retained earnings and belongs in equity.
    net_income = profit_and_loss(None, as_of_date)['net_income']
    total_equity_incl_ni = total_equity + net_income

    return {
        'as_of_date': as_of_date,
        'assets': assets,
        'liabilities': liabilities,
        'equity': equity,
        'net_income': net_income,
        'total_assets': total_assets,
        'total_liabilities': total_liabilities,
        'total_equity': total_equity_incl_ni,
        'balanced': total_assets == total_liabilities + total_equity_incl_ni,
    }


CASH_CODES = ['1000', '1005', '1010']
WORKING_CAPITAL_CODES = ['1100', '1200', '2000', '2100']  # AR, Inventory, AP, VAT payable
EQUITY_CODES = ['3000']


def cash_flow(start_date=None, end_date=None):
    """Indirect-method cash flow statement for the period."""
    from datetime import timedelta

    net_income = profit_and_loss(start_date, end_date)['net_income']
    start_boundary = (start_date - timedelta(days=1)) if start_date else None
    balances_start = _account_balances(end_date=start_boundary) if start_boundary else {}
    balances_end = _account_balances(end_date=end_date)

    def signed_balance(account, balances):
        b = balances.get(account.id)
        if not b:
            return Decimal('0')
        if account.type == 'asset':
            return b['debit'] - b['credit']
        return b['credit'] - b['debit']

    working_capital_change = Decimal('0')
    for code in WORKING_CAPITAL_CODES:
        account = Account.objects.filter(code=code).first()
        if not account:
            continue
        delta = signed_balance(account, balances_end) - signed_balance(account, balances_start)
        if account.type == 'asset':
            working_capital_change -= delta
        else:
            working_capital_change += delta

    operating = net_income + working_capital_change

    financing = Decimal('0')
    for code in EQUITY_CODES:
        account = Account.objects.filter(code=code).first()
        if account:
            financing += signed_balance(account, balances_end) - signed_balance(account, balances_start)

    net_change = operating + financing

    cash_end = Decimal('0')
    cash_start = Decimal('0')
    for code in CASH_CODES:
        account = Account.objects.filter(code=code).first()
        if account:
            cash_end += signed_balance(account, balances_end)
            cash_start += signed_balance(account, balances_start)
    actual = cash_end - cash_start

    return {
        'start_date': start_date,
        'end_date': end_date,
        'net_income': net_income,
        'working_capital_change': working_capital_change,
        'operating_cash_flow': operating,
        'financing_cash_flow': financing,
        'net_change': net_change,
        'actual_cash_change': actual,
        'reconciled': net_change == actual,
    }


def _age_bucket(days):
    if days <= 30:
        return '0-30'
    if days <= 60:
        return '31-60'
    if days <= 90:
        return '61-90'
    return '90+'


def _aged_invoices(invoice_type, as_of_date):
    invoices = Invoice.objects.filter(invoice_type=invoice_type).exclude(status__in=['void', 'paid'])
    rows = []
    for invoice in invoices:
        allocated = InvoicePayment.objects.filter(invoice=invoice).aggregate(s=Sum('amount'))['s'] or Decimal('0')
        outstanding = invoice.total - allocated
        if outstanding <= 0:
            continue
        days = (as_of_date - invoice.due_date).days
        rows.append({
            'party': invoice.party,
            'invoice_number': invoice.invoice_number,
            'due_date': invoice.due_date,
            'outstanding': outstanding,
            'bucket': _age_bucket(days),
        })
    return rows


def _summarize_aging(rows):
    buckets = {'0-30': 'current', '31-60': 'b31_60', '61-90': 'b61_90', '90+': 'b90_plus'}
    summary = {}
    for row in rows:
        party = row['party']
        entry = summary.setdefault(party.id, {
            'party': party,
            'current': Decimal('0'),
            'b31_60': Decimal('0'),
            'b61_90': Decimal('0'),
            'b90_plus': Decimal('0'),
            'total': Decimal('0'),
        })
        entry[buckets[row['bucket']]] += row['outstanding']
        entry['total'] += row['outstanding']
    return list(summary.values())


def aged_receivables(as_of_date=None):
    """Amounts customers owe us, bucketed by days overdue."""
    as_of = as_of_date or timezone.localdate()
    return _summarize_aging(_aged_invoices('sale', as_of))


def aged_payables(as_of_date=None):
    """Amounts we owe vendors, bucketed by days overdue."""
    as_of = as_of_date or timezone.localdate()
    return _summarize_aging(_aged_invoices('purchase', as_of))


def vat_return(start_date=None, end_date=None):
    """Output VAT (sales) minus input VAT (purchases) for the period."""
    vat = Account.objects.filter(code='2100').first()
    b = _account_balances(start_date, end_date).get(vat.id) if vat else None
    output_vat = b['credit'] if b else Decimal('0')
    input_vat = b['debit'] if b else Decimal('0')
    return {
        'start_date': start_date,
        'end_date': end_date,
        'output_vat': output_vat,
        'input_vat': input_vat,
        'net_vat': output_vat - input_vat,
    }


def budget_variance(start_date=None, end_date=None):
    """Budget vs actual (and variance) for budgets overlapping the period."""
    balances = _account_balances(start_date, end_date)
    budgets = Budget.objects.select_related('account')
    if start_date:
        budgets = budgets.filter(period_end__gte=start_date)
    if end_date:
        budgets = budgets.filter(period_start__lte=end_date)

    rows = []
    for budget in budgets:
        account = budget.account
        b = balances.get(account.id, {'debit': Decimal('0'), 'credit': Decimal('0')})
        if account.type in ('asset', 'expense'):
            actual = b['debit'] - b['credit']
        else:
            actual = b['credit'] - b['debit']
        rows.append({
            'account': account,
            'budget_amount': budget.amount,
            'actual': actual,
            'variance': actual - budget.amount,
        })
    return rows


def general_ledger(start_date=None, end_date=None):
    """All posted entries (with lines) in the period, chronological."""
    entries = JournalEntry.objects.filter(status='posted').prefetch_related('lines__account')
    if start_date:
        entries = entries.filter(entry_date__gte=start_date)
    if end_date:
        entries = entries.filter(entry_date__lte=end_date)
    entries = entries.order_by('entry_date', 'id')

    rows = []
    for entry in entries:
        lines = list(entry.lines.all())
        total_debit = sum((l.amount for l in lines if l.line_type == 'debit'), Decimal('0'))
        total_credit = sum((l.amount for l in lines if l.line_type == 'credit'), Decimal('0'))
        rows.append({
            'entry': entry,
            'lines': lines,
            'total_debit': total_debit,
            'total_credit': total_credit,
        })
    return rows


def account_ledger(account, start_date=None, end_date=None):
    """All posted lines for one account with a running balance."""
    lines = JournalEntryLine.objects.filter(
        account=account, journal_entry__status='posted',
    ).select_related('journal_entry')
    if start_date:
        lines = lines.filter(journal_entry__entry_date__gte=start_date)
    if end_date:
        lines = lines.filter(journal_entry__entry_date__lte=end_date)
    lines = lines.order_by('journal_entry__entry_date', 'journal_entry__id', 'line_no')

    running = Decimal('0')
    rows = []
    for line in lines:
        if account.type in ('asset', 'expense'):
            running += line.amount if line.line_type == 'debit' else -line.amount
        else:
            running += line.amount if line.line_type == 'credit' else -line.amount
        rows.append({
            'date': line.journal_entry.entry_date,
            'reference': line.journal_entry.reference,
            'description': line.journal_entry.description,
            'debit': line.amount if line.line_type == 'debit' else Decimal('0'),
            'credit': line.amount if line.line_type == 'credit' else Decimal('0'),
            'balance': running,
        })
    return {'account': account, 'rows': rows, 'closing_balance': running}


def party_statement(party, start_date=None, end_date=None):
    """Invoices and payments for a party, with net balance."""
    invoices = Invoice.objects.filter(party=party).exclude(status='void')
    payments = Payment.objects.filter(party=party)
    if start_date:
        invoices = invoices.filter(issue_date__gte=start_date)
        payments = payments.filter(payment_date__gte=start_date)
    if end_date:
        invoices = invoices.filter(issue_date__lte=end_date)
        payments = payments.filter(payment_date__lte=end_date)

    total_invoiced = invoices.aggregate(s=Sum('total'))['s'] or Decimal('0')
    total_received = payments.filter(direction='incoming').aggregate(s=Sum('amount'))['s'] or Decimal('0')
    total_paid = payments.filter(direction='outgoing').aggregate(s=Sum('amount'))['s'] or Decimal('0')

    if party.type == 'vendor':
        balance = total_invoiced - total_paid
    else:
        balance = total_invoiced - total_received

    return {
        'party': party,
        'invoices': list(invoices.order_by('issue_date')),
        'payments': list(payments.order_by('payment_date')),
        'total_invoiced': total_invoiced,
        'balance': balance,
    }


def financial_ratios(as_of_date=None):
    """Key financial ratios derived from the P&L and balance sheet."""
    pnl = profit_and_loss(None, as_of_date)
    bs = balance_sheet(as_of_date)

    revenue = pnl['total_revenue']
    net_income = pnl['net_income']
    total_assets = bs['total_assets']
    total_liabilities = bs['total_liabilities']
    total_equity = bs['total_equity']

    cogs = Decimal('0')
    for e in pnl['expense']:
        if e['account'].code == '5000':
            cogs = e['amount']
            break
    gross_profit = revenue - cogs

    return {
        'revenue': revenue,
        'gross_profit': gross_profit,
        'gross_margin': (gross_profit / revenue) if revenue else None,
        'net_income': net_income,
        'net_margin': (net_income / revenue) if revenue else None,
        'current_ratio': (total_assets / total_liabilities) if total_liabilities else None,
        'return_on_equity': (net_income / total_equity) if total_equity else None,
    }
