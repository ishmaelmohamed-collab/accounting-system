"""Automated tests for the accounting service layer and reports."""
from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from ledger import reports, services
from ledger.models import Account, Budget, FiscalPeriod, Invoice, JournalEntry, Party, TaxRate


@pytest.mark.django_db
def test_balanced_entry_posts():
    cash = Account.objects.get(code='1000')
    revenue = Account.objects.get(code='4000')
    entry = services.post_journal_entry(timezone.localdate(), 'T-1', 'balanced', [
        {'account': cash, 'line_type': 'debit', 'amount': Decimal('100.00'), 'party': None},
        {'account': revenue, 'line_type': 'credit', 'amount': Decimal('100.00'), 'party': None},
    ])
    assert entry.status == 'posted'
    assert entry.lines.count() == 2


@pytest.mark.django_db
def test_unbalanced_entry_rejected():
    cash = Account.objects.get(code='1000')
    with pytest.raises(ValueError):
        services.post_journal_entry(timezone.localdate(), 'T-2', 'unbalanced', [
            {'account': cash, 'line_type': 'debit', 'amount': Decimal('50.00'), 'party': None},
        ])


@pytest.mark.django_db
def test_idempotency_key_prevents_duplicates():
    cash = Account.objects.get(code='1000')
    revenue = Account.objects.get(code='4000')
    lines = [
        {'account': cash, 'line_type': 'debit', 'amount': Decimal('10.00'), 'party': None},
        {'account': revenue, 'line_type': 'credit', 'amount': Decimal('10.00'), 'party': None},
    ]
    first = services.post_journal_entry(timezone.localdate(), 'T-3', 'idem', lines, idempotency_key='idem-1')
    replay = services.post_journal_entry(timezone.localdate(), 'T-3', 'idem', lines, idempotency_key='idem-1')
    assert first.id == replay.id
    assert JournalEntry.objects.filter(idempotency_key='idem-1').count() == 1


@pytest.mark.django_db
def test_period_lock_rejects_posting():
    cash = Account.objects.get(code='1000')
    revenue = Account.objects.get(code='4000')
    today = timezone.localdate()
    FiscalPeriod.objects.create(
        name='Closed', start_date=today - timedelta(days=1),
        end_date=today + timedelta(days=1), is_closed=True,
    )
    with pytest.raises(ValueError):
        services.post_journal_entry(today, 'T-4', 'locked', [
            {'account': cash, 'line_type': 'debit', 'amount': Decimal('1.00'), 'party': None},
            {'account': revenue, 'line_type': 'credit', 'amount': Decimal('1.00'), 'party': None},
        ])


@pytest.mark.django_db
def test_reversal_swaps_lines():
    cash = Account.objects.get(code='1000')
    revenue = Account.objects.get(code='4000')
    target = services.post_journal_entry(timezone.localdate(), 'T-5', 'target', [
        {'account': cash, 'line_type': 'debit', 'amount': Decimal('25.00'), 'party': None},
        {'account': revenue, 'line_type': 'credit', 'amount': Decimal('25.00'), 'party': None},
    ])
    reversal = services.reverse_entry(target)
    assert reversal.reversal_of_id == target.id
    assert sorted(l.line_type for l in reversal.lines.all()) == ['credit', 'debit']


@pytest.mark.django_db
def test_cash_flow_reconciles():
    cash = Account.objects.get(code='1000')
    revenue = Account.objects.get(code='4000')
    services.post_journal_entry(timezone.localdate(), 'T-6', 'cash', [
        {'account': cash, 'line_type': 'debit', 'amount': Decimal('100.00'), 'party': None},
        {'account': revenue, 'line_type': 'credit', 'amount': Decimal('100.00'), 'party': None},
    ])
    cf = reports.cash_flow()
    assert cf['reconciled'] is True


@pytest.mark.django_db
def test_invoice_creates_posted_entry():
    party = Party.objects.create(name='Test Co', type='customer')
    revenue = Account.objects.get(code='4000')
    vat = TaxRate.objects.get(name='VAT 16%')
    today = timezone.localdate()
    invoice = services.create_invoice('INV-TEST-1', party, 'sale', today, today, [
        {'description': 'Service', 'account': revenue, 'quantity': 1,
         'unit_price': Decimal('1000.00'), 'amount': Decimal('1000.00')},
    ], tax_rate=vat)
    assert invoice.status == 'issued'
    assert invoice.total == Decimal('1160.00')
    assert invoice.journal_entry is not None
    assert invoice.journal_entry.status == 'posted'


@pytest.mark.django_db
def test_vat_return_computes_output_vat():
    party = Party.objects.create(name='VAT Co', type='customer')
    revenue = Account.objects.get(code='4000')
    vat = TaxRate.objects.get(name='VAT 16%')
    today = timezone.localdate()
    services.create_invoice('INV-VAT-1', party, 'sale', today, today, [
        {'description': 'Service', 'account': revenue, 'quantity': 1,
         'unit_price': Decimal('1000.00'), 'amount': Decimal('1000.00')},
    ], tax_rate=vat)
    vr = reports.vat_return()
    assert vr['output_vat'] == Decimal('160.00')
    assert vr['net_vat'] == Decimal('160.00')


@pytest.mark.django_db
def test_aged_receivables_buckets():
    party = Party.objects.create(name='Aging Co', type='customer')
    today = timezone.localdate()
    Invoice.objects.create(
        invoice_number='INV-AGE-1', party=party, invoice_type='sale',
        issue_date=today - timedelta(days=130), due_date=today - timedelta(days=100),
        subtotal=Decimal('1000.00'), tax_amount=Decimal('0.00'), total=Decimal('1000.00'),
        status='issued',
    )
    rows = reports.aged_receivables(today)
    assert len(rows) == 1
    assert rows[0]['total'] == Decimal('1000.00')
    assert rows[0]['b90_plus'] == Decimal('1000.00')


@pytest.mark.django_db
def test_budget_variance():
    rent = Account.objects.get(code='6000')
    bank = Account.objects.get(code='1005')
    today = timezone.localdate()
    Budget.objects.create(
        account=rent, period_start=today - timedelta(days=5),
        period_end=today + timedelta(days=5), amount=Decimal('10000.00'),
    )
    services.post_journal_entry(today, 'BUD-1', 'rent', [
        {'account': rent, 'line_type': 'debit', 'amount': Decimal('8000.00'), 'party': None},
        {'account': bank, 'line_type': 'credit', 'amount': Decimal('8000.00'), 'party': None},
    ])
    rows = reports.budget_variance()
    assert len(rows) == 1
    assert rows[0]['actual'] == Decimal('8000.00')
    assert rows[0]['variance'] == Decimal('-2000.00')


@pytest.mark.django_db
def test_account_ledger_running_balance():
    cash = Account.objects.get(code='1000')
    revenue = Account.objects.get(code='4000')
    rent = Account.objects.get(code='6000')
    today = timezone.localdate()
    services.post_journal_entry(today, 'AL-1', 'income', [
        {'account': cash, 'line_type': 'debit', 'amount': Decimal('100.00'), 'party': None},
        {'account': revenue, 'line_type': 'credit', 'amount': Decimal('100.00'), 'party': None},
    ])
    services.post_journal_entry(today, 'AL-2', 'rent', [
        {'account': rent, 'line_type': 'debit', 'amount': Decimal('40.00'), 'party': None},
        {'account': cash, 'line_type': 'credit', 'amount': Decimal('40.00'), 'party': None},
    ])
    data = reports.account_ledger(cash)
    assert data['closing_balance'] == Decimal('60.00')
    assert len(data['rows']) == 2
    assert data['rows'][1]['balance'] == Decimal('60.00')


@pytest.mark.django_db
def test_general_ledger_lists_entries():
    cash = Account.objects.get(code='1000')
    revenue = Account.objects.get(code='4000')
    services.post_journal_entry(timezone.localdate(), 'GL-1', 'test', [
        {'account': cash, 'line_type': 'debit', 'amount': Decimal('10.00'), 'party': None},
        {'account': revenue, 'line_type': 'credit', 'amount': Decimal('10.00'), 'party': None},
    ])
    rows = reports.general_ledger()
    assert any(r['entry'].reference == 'GL-1' for r in rows)


@pytest.mark.django_db
def test_financial_ratios():
    cash = Account.objects.get(code='1000')
    revenue = Account.objects.get(code='4000')
    services.post_journal_entry(timezone.localdate(), 'FR-1', 'revenue', [
        {'account': cash, 'line_type': 'debit', 'amount': Decimal('1000.00'), 'party': None},
        {'account': revenue, 'line_type': 'credit', 'amount': Decimal('1000.00'), 'party': None},
    ])
    fr = reports.financial_ratios()
    assert fr['revenue'] == Decimal('1000.00')
    assert fr['gross_margin'] == Decimal('1.00')
    assert fr['net_margin'] == Decimal('1.00')
