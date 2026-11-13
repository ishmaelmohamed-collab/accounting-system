"""
Django ORM models for the accounting database.

These models map to the existing PostgreSQL tables created by the SQL
migrations in the ``sql/`` directory. They use ``managed = False``, so Django
will NOT create, alter, or delete these tables — the database schema (including
its triggers, e.g. the balanced-journal-entry enforcement) is the source of
truth.

Integrity is enforced by the database itself:
  * an entry cannot be posted unless debits == credits
  * a posted entry's lines cannot be modified
  * invoice totals must equal subtotal + tax
"""
from django.db import models


class Account(models.Model):
    class Type(models.TextChoices):
        ASSET = 'asset', 'Asset'
        LIABILITY = 'liability', 'Liability'
        EQUITY = 'equity', 'Equity'
        REVENUE = 'revenue', 'Revenue'
        EXPENSE = 'expense', 'Expense'

    class NormalBalance(models.TextChoices):
        DEBIT = 'debit', 'Debit'
        CREDIT = 'credit', 'Credit'

    id = models.BigAutoField(primary_key=True)
    code = models.CharField(max_length=32, unique=True)
    name = models.CharField(max_length=255)
    type = models.CharField(max_length=20, choices=Type.choices)
    normal_balance = models.CharField(max_length=10, choices=NormalBalance.choices)
    parent = models.ForeignKey('self', on_delete=models.RESTRICT, null=True, blank=True, related_name='children')
    description = models.TextField(blank=True, null=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = 'accounts'
        ordering = ['code']

    def __str__(self):
        return f'{self.code} {self.name}'


class JournalEntry(models.Model):
    class Status(models.TextChoices):
        DRAFT = 'draft', 'Draft'
        POSTED = 'posted', 'Posted'

    id = models.BigAutoField(primary_key=True)
    entry_date = models.DateField()
    reference = models.CharField(max_length=100, blank=True, null=True)
    description = models.TextField(blank=True, null=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT)
    posted_at = models.DateTimeField(blank=True, null=True, editable=False)
    idempotency_key = models.CharField(max_length=100, unique=True, blank=True, null=True)
    reversal_of = models.ForeignKey('self', on_delete=models.SET_NULL, null=True, blank=True, related_name='reversals')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = 'journal_entries'
        ordering = ['-entry_date', '-id']

    def __str__(self):
        return f'{self.reference or self.id} ({self.status})'


class JournalEntryLine(models.Model):
    class LineType(models.TextChoices):
        DEBIT = 'debit', 'Debit'
        CREDIT = 'credit', 'Credit'

    id = models.BigAutoField(primary_key=True)
    journal_entry = models.ForeignKey(JournalEntry, on_delete=models.CASCADE, related_name='lines')
    account = models.ForeignKey(Account, on_delete=models.RESTRICT, related_name='journal_lines')
    line_type = models.CharField(max_length=10, choices=LineType.choices)
    amount = models.DecimalField(max_digits=20, decimal_places=2)
    description = models.TextField(blank=True, null=True)
    line_no = models.PositiveIntegerField()
    party = models.ForeignKey('Party', on_delete=models.RESTRICT, null=True, blank=True, related_name='journal_lines')

    class Meta:
        managed = False
        db_table = 'journal_entry_lines'
        ordering = ['journal_entry_id', 'line_no']
        unique_together = (('journal_entry', 'line_no'),)

    def __str__(self):
        return f'{self.journal_entry_id} #{self.line_no} {self.line_type} {self.amount}'


class Party(models.Model):
    class Type(models.TextChoices):
        CUSTOMER = 'customer', 'Customer'
        VENDOR = 'vendor', 'Vendor'
        BOTH = 'both', 'Both'

    id = models.BigAutoField(primary_key=True)
    name = models.CharField(max_length=255)
    type = models.CharField(max_length=10, choices=Type.choices, default=Type.CUSTOMER)
    email = models.EmailField(blank=True, null=True)
    phone = models.CharField(max_length=50, blank=True, null=True)
    address = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = 'parties'
        ordering = ['name']

    def __str__(self):
        return self.name


class TaxRate(models.Model):
    id = models.BigAutoField(primary_key=True)
    name = models.CharField(max_length=100, unique=True)
    rate = models.DecimalField(max_digits=6, decimal_places=3)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = 'tax_rates'
        ordering = ['name']

    def __str__(self):
        return self.name


class Invoice(models.Model):
    class Type(models.TextChoices):
        SALE = 'sale', 'Sale'
        PURCHASE = 'purchase', 'Purchase'

    class Status(models.TextChoices):
        DRAFT = 'draft', 'Draft'
        ISSUED = 'issued', 'Issued'
        PAID = 'paid', 'Paid'
        VOID = 'void', 'Void'

    id = models.BigAutoField(primary_key=True)
    invoice_number = models.CharField(max_length=50, unique=True)
    party = models.ForeignKey(Party, on_delete=models.RESTRICT, related_name='invoices')
    invoice_type = models.CharField(max_length=10, choices=Type.choices)
    issue_date = models.DateField()
    due_date = models.DateField()
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT)
    subtotal = models.DecimalField(max_digits=20, decimal_places=2, default=0)
    tax_amount = models.DecimalField(max_digits=20, decimal_places=2, default=0)
    total = models.DecimalField(max_digits=20, decimal_places=2, default=0)
    notes = models.TextField(blank=True, null=True)
    journal_entry = models.ForeignKey(JournalEntry, on_delete=models.SET_NULL, null=True, blank=True, related_name='invoices')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = 'invoices'
        ordering = ['-issue_date', '-id']

    def __str__(self):
        return f'{self.invoice_number} ({self.status})'


class InvoiceLine(models.Model):
    id = models.BigAutoField(primary_key=True)
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name='lines')
    description = models.CharField(max_length=255)
    account = models.ForeignKey(Account, on_delete=models.RESTRICT, related_name='invoice_lines')
    quantity = models.DecimalField(max_digits=15, decimal_places=3, default=1)
    unit_price = models.DecimalField(max_digits=20, decimal_places=2, default=0)
    amount = models.DecimalField(max_digits=20, decimal_places=2, default=0)
    tax_rate = models.ForeignKey(TaxRate, on_delete=models.RESTRICT, null=True, blank=True, related_name='invoice_lines')
    line_no = models.PositiveIntegerField()

    class Meta:
        managed = False
        db_table = 'invoice_lines'
        ordering = ['invoice_id', 'line_no']
        unique_together = (('invoice', 'line_no'),)

    def __str__(self):
        return f'{self.invoice_id} #{self.line_no} {self.description}'


class Payment(models.Model):
    class Direction(models.TextChoices):
        INCOMING = 'incoming', 'Incoming'
        OUTGOING = 'outgoing', 'Outgoing'

    class Method(models.TextChoices):
        CASH = 'cash', 'Cash'
        BANK = 'bank', 'Bank'
        MOBILE_MONEY = 'mobile_money', 'Mobile Money'
        OTHER = 'other', 'Other'

    id = models.BigAutoField(primary_key=True)
    payment_date = models.DateField()
    party = models.ForeignKey(Party, on_delete=models.RESTRICT, related_name='payments')
    direction = models.CharField(max_length=10, choices=Direction.choices, default=Direction.INCOMING)
    amount = models.DecimalField(max_digits=20, decimal_places=2)
    method = models.CharField(max_length=20, choices=Method.choices, default=Method.BANK)
    reference = models.CharField(max_length=100, blank=True, null=True)
    journal_entry = models.ForeignKey(JournalEntry, on_delete=models.SET_NULL, null=True, blank=True, related_name='payments')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = 'payments'
        ordering = ['-payment_date', '-id']

    def __str__(self):
        return f'{self.reference or self.id} {self.amount}'


class InvoicePayment(models.Model):
    pk = models.CompositePrimaryKey('invoice_id', 'payment_id')
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name='payment_allocations')
    payment = models.ForeignKey(Payment, on_delete=models.CASCADE, related_name='invoice_allocations')
    amount = models.DecimalField(max_digits=20, decimal_places=2)

    class Meta:
        managed = False
        db_table = 'invoice_payments'

    def __str__(self):
        return f'{self.invoice_id} <- {self.payment_id} ({self.amount})'


class FiscalPeriod(models.Model):
    id = models.BigAutoField(primary_key=True)
    name = models.CharField(max_length=255)
    start_date = models.DateField()
    end_date = models.DateField()
    is_closed = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = 'fiscal_periods'
        ordering = ['start_date']

    def __str__(self):
        return self.name


class Budget(models.Model):
    id = models.BigAutoField(primary_key=True)
    account = models.ForeignKey(Account, on_delete=models.CASCADE, related_name='budgets')
    period_start = models.DateField()
    period_end = models.DateField()
    amount = models.DecimalField(max_digits=20, decimal_places=2)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = 'budgets'
        ordering = ['period_start', 'account']

    def __str__(self):
        return f'{self.account} {self.period_start}–{self.period_end} {self.amount}'
