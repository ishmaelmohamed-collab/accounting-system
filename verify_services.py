"""Quick verification of the business-logic service layer.

Runs each operation inside a transaction that is rolled back at the end,
so the seeded demo data is left untouched.
"""
import os

import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'accounting_project.settings')
django.setup()

from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from ledger import services
from ledger.models import Account, Party, TaxRate


with transaction.atomic():
    cash = Account.objects.get(code='1000')
    revenue = Account.objects.get(code='4000')
    vat = TaxRate.objects.get(name='VAT 16%')
    today = timezone.localdate()

    # 1. balanced journal entry -> should post
    entry = services.post_journal_entry(today, 'TEST-BAL', 'Balanced test', [
        {'account': cash, 'line_type': 'debit', 'amount': Decimal('100.00'), 'party': None},
        {'account': revenue, 'line_type': 'credit', 'amount': Decimal('100.00'), 'party': None},
    ])
    print(f'1. balanced entry posted (id={entry.id}, status={entry.status})')

    # 2. unbalanced journal entry -> should be rejected with a clean error
    try:
        services.post_journal_entry(today, 'TEST-UNBAL', 'Unbalanced test', [
            {'account': cash, 'line_type': 'debit', 'amount': Decimal('50.00'), 'party': None},
        ])
        print('2. FAIL: unbalanced entry was not rejected')
    except ValueError as exc:
        print(f'2. unbalanced entry rejected: {exc}')

    # 3. sale invoice -> should create invoice + posted journal entry
    party = Party.objects.create(name='Service Test Co', type='customer')
    invoice = services.create_invoice('TEST-INV-1', party, 'sale', today, today, [
        {'description': 'Test service', 'account': revenue, 'quantity': 1,
         'unit_price': Decimal('1000.00'), 'amount': Decimal('1000.00')},
    ], tax_rate=vat)
    print(f'3. invoice {invoice.invoice_number}: total={invoice.total}, '
          f'journal_entry_id={invoice.journal_entry_id}')

    # 4. incoming payment allocated to the invoice -> should mark it paid
    payment = services.record_payment(
        today, party, 'incoming', '1160.00', 'bank', 'TEST-PAY-1',
        allocations=[{'invoice': invoice, 'amount': Decimal('1160.00')}],
    )
    invoice.refresh_from_db()
    print(f'4. payment recorded (id={payment.id}); invoice status -> {invoice.status}')

    transaction.set_rollback(True)

print('Service-layer verification passed. All changes rolled back.')
