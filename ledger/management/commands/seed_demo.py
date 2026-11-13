"""Seed realistic demo data into the accounting system.

Usage:
    python manage.py seed_demo

Creates parties, invoices, payments, and balanced (posted) journal entries
for a small business, exercising the double-entry rules enforced by the DB.
"""
from datetime import timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.utils import timezone

from ledger.models import (
    Account,
    Invoice,
    InvoiceLine,
    InvoicePayment,
    JournalEntry,
    JournalEntryLine,
    Party,
    Payment,
    TaxRate,
)


class Command(BaseCommand):
    help = 'Seed demo data (parties, invoices, payments, journal entries)'

    def handle(self, *args, **options):
        if JournalEntry.objects.exists():
            self.stdout.write(self.style.WARNING('Data already exists — skipping seed.'))
            return

        today = timezone.localdate()
        due = today + timedelta(days=30)

        def acct(code):
            return Account.objects.get(code=code)

        # --- parties ---
        acme = Party.objects.create(name='Acme Ltd', type='customer', email='billing@acme.example', phone='+254 700 111 222')
        globex = Party.objects.create(name='Globex Corp', type='customer', email='ap@globex.example', phone='+254 711 333 444')
        depot = Party.objects.create(name='Office Depot', type='vendor', email='sales@officedepot.example', phone='+254 722 555 666')

        vat = TaxRate.objects.get(name='VAT 16%')
        revenue = acct('4000')
        inventory = acct('1200')

        # --- helper: create + post a balanced journal entry ---
        def post_entry(reference, description, lines):
            entry = JournalEntry.objects.create(
                entry_date=today, reference=reference, description=description,
            )
            for i, (code, line_type, amount, party) in enumerate(lines, start=1):
                JournalEntryLine.objects.create(
                    journal_entry=entry,
                    account=acct(code),
                    line_type=line_type,
                    amount=Decimal(amount),
                    line_no=i,
                    party=party,
                )
            entry.status = JournalEntry.Status.POSTED  # DB trigger checks debits == credits
            entry.save()
            return entry

        # --- journal entries ---
        post_entry('CAP-001', 'Owner capital injection', [
            ('1005', 'debit', '50000.00', None),
            ('3000', 'credit', '50000.00', None),
        ])
        e_acme = post_entry('INV-0001', 'Sale to Acme Ltd', [
            ('1100', 'debit', '34800.00', acme),
            ('4000', 'credit', '30000.00', acme),
            ('2100', 'credit', '4800.00', acme),
        ])
        e_globex = post_entry('INV-0002', 'Sale to Globex Corp', [
            ('1100', 'debit', '17400.00', globex),
            ('4000', 'credit', '15000.00', globex),
            ('2100', 'credit', '2400.00', globex),
        ])
        e_purchase = post_entry('INV-0003', 'Purchase inventory from Office Depot', [
            ('1200', 'debit', '10000.00', depot),
            ('2100', 'debit', '1600.00', depot),   # input VAT reduces VAT payable
            ('2000', 'credit', '11600.00', depot),
        ])
        e_pay_acme = post_entry('PYMT-0001', 'Payment received from Acme Ltd', [
            ('1005', 'debit', '20000.00', acme),
            ('1100', 'credit', '20000.00', acme),
        ])
        e_pay_depot = post_entry('PYMT-0002', 'Payment to Office Depot', [
            ('2000', 'debit', '11600.00', depot),
            ('1005', 'credit', '11600.00', depot),
        ])
        post_entry('RENT-001', 'Monthly office rent', [
            ('6000', 'debit', '8000.00', None),
            ('1005', 'credit', '8000.00', None),
        ])
        post_entry('SAL-001', 'Monthly salaries', [
            ('6100', 'debit', '12000.00', None),
            ('1005', 'credit', '12000.00', None),
        ])

        # --- invoices ---
        inv1 = Invoice.objects.create(
            invoice_number='INV-0001', party=acme, invoice_type='sale',
            issue_date=today, due_date=due, status='issued',
            subtotal=Decimal('30000.00'), tax_amount=Decimal('4800.00'), total=Decimal('34800.00'),
            journal_entry=e_acme,
        )
        InvoiceLine.objects.create(invoice=inv1, description='Consulting services', account=revenue,
                                   quantity=10, unit_price=Decimal('3000.00'), amount=Decimal('30000.00'),
                                   tax_rate=vat, line_no=1)

        inv2 = Invoice.objects.create(
            invoice_number='INV-0002', party=globex, invoice_type='sale',
            issue_date=today, due_date=due, status='issued',
            subtotal=Decimal('15000.00'), tax_amount=Decimal('2400.00'), total=Decimal('17400.00'),
            journal_entry=e_globex,
        )
        InvoiceLine.objects.create(invoice=inv2, description='Software license', account=revenue,
                                   quantity=1, unit_price=Decimal('15000.00'), amount=Decimal('15000.00'),
                                   tax_rate=vat, line_no=1)

        inv3 = Invoice.objects.create(
            invoice_number='INV-0003', party=depot, invoice_type='purchase',
            issue_date=today, due_date=due, status='paid',
            subtotal=Decimal('10000.00'), tax_amount=Decimal('1600.00'), total=Decimal('11600.00'),
            journal_entry=e_purchase,
        )
        InvoiceLine.objects.create(invoice=inv3, description='Office inventory', account=inventory,
                                   quantity=100, unit_price=Decimal('100.00'), amount=Decimal('10000.00'),
                                   tax_rate=vat, line_no=1)

        # --- payments + allocations ---
        pay1 = Payment.objects.create(payment_date=today, party=acme, direction='incoming',
                                      amount=Decimal('20000.00'), method='bank', reference='PYMT-0001',
                                      journal_entry=e_pay_acme)
        pay2 = Payment.objects.create(payment_date=today, party=depot, direction='outgoing',
                                      amount=Decimal('11600.00'), method='bank', reference='PYMT-0002',
                                      journal_entry=e_pay_depot)
        InvoicePayment.objects.create(invoice=inv1, payment=pay1, amount=Decimal('20000.00'))
        InvoicePayment.objects.create(invoice=inv3, payment=pay2, amount=Decimal('11600.00'))

        self.stdout.write(self.style.SUCCESS(
            f'Seeded: 3 parties, 3 invoices, 2 payments, {JournalEntry.objects.count()} posted journal entries.'
        ))
