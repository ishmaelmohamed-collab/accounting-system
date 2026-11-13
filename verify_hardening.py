"""Verify ledger hardening: idempotency, reversals, period locks, cash flow."""
import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'accounting_project.settings')
django.setup()

from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from ledger import reports, services
from ledger.models import Account, FiscalPeriod


with transaction.atomic():
    cash = Account.objects.get(code='1000')
    revenue = Account.objects.get(code='4000')
    today = timezone.localdate()

    # 1. idempotency — replaying the same key must not double-post
    key = 'TEST-IDEM-001'
    e1 = services.post_journal_entry(today, 'IDEM-TEST', 'Idempotency test', [
        {'account': cash, 'line_type': 'debit', 'amount': Decimal('10.00'), 'party': None},
        {'account': revenue, 'line_type': 'credit', 'amount': Decimal('10.00'), 'party': None},
    ], idempotency_key=key)
    e2 = services.post_journal_entry(today, 'IDEM-TEST', 'Idempotency test', [
        {'account': cash, 'line_type': 'debit', 'amount': Decimal('10.00'), 'party': None},
        {'account': revenue, 'line_type': 'credit', 'amount': Decimal('10.00'), 'party': None},
    ], idempotency_key=key)
    print(f'1. idempotency: first={e1.id} replay={e2.id} same_entry={e1.id == e2.id}')

    # 2. reversal — creates a new entry with swapped debit/credit
    target = services.post_journal_entry(today, 'REV-TARGET', 'Target to reverse', [
        {'account': cash, 'line_type': 'debit', 'amount': Decimal('25.00'), 'party': None},
        {'account': revenue, 'line_type': 'credit', 'amount': Decimal('25.00'), 'party': None},
    ])
    rev = services.reverse_entry(target)
    types = sorted(l.line_type for l in rev.lines.all())
    print(f'2. reversal: id={rev.id} reversal_of={rev.reversal_of_id} lines={types}')

    # 3. period lock — posting into a closed period must be rejected
    FiscalPeriod.objects.create(
        name='Locked Test Period',
        start_date=today - timedelta(days=5),
        end_date=today + timedelta(days=5),
        is_closed=True,
    )
    try:
        services.post_journal_entry(today, 'LOCK-TEST', 'Should be rejected', [
            {'account': cash, 'line_type': 'debit', 'amount': Decimal('5.00'), 'party': None},
            {'account': revenue, 'line_type': 'credit', 'amount': Decimal('5.00'), 'party': None},
        ])
        print('3. period lock: FAIL (not rejected)')
    except ValueError as exc:
        print(f'3. period lock: rejected -> {exc}')

    # 4. cash flow — must reconcile with the cash accounts
    cf = reports.cash_flow()
    print(f'4. cash flow: operating={cf["operating_cash_flow"]:.2f} '
          f'financing={cf["financing_cash_flow"]:.2f} net={cf["net_change"]:.2f} '
          f'reconciled={cf["reconciled"]}')

    transaction.set_rollback(True)

print('Ledger hardening verified. All changes rolled back.')
