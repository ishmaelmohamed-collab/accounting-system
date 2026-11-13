from django.contrib import admin

from .models import (
    Account,
    Budget,
    FiscalPeriod,
    Invoice,
    InvoiceLine,
    JournalEntry,
    JournalEntryLine,
    Party,
    Payment,
    TaxRate,
)


@admin.register(Account)
class AccountAdmin(admin.ModelAdmin):
    list_display = ('code', 'name', 'type', 'normal_balance', 'is_active')
    list_filter = ('type', 'normal_balance', 'is_active')
    search_fields = ('code', 'name')
    ordering = ('code',)


@admin.register(JournalEntry)
class JournalEntryAdmin(admin.ModelAdmin):
    list_display = ('id', 'entry_date', 'reference', 'status', 'posted_at')
    list_filter = ('status',)
    search_fields = ('reference', 'description')
    date_hierarchy = 'entry_date'


@admin.register(JournalEntryLine)
class JournalEntryLineAdmin(admin.ModelAdmin):
    list_display = ('journal_entry', 'line_no', 'account', 'line_type', 'amount', 'party')
    list_filter = ('line_type',)
    list_select_related = ('journal_entry', 'account', 'party')


@admin.register(Party)
class PartyAdmin(admin.ModelAdmin):
    list_display = ('name', 'type', 'email', 'phone')
    list_filter = ('type',)
    search_fields = ('name', 'email', 'phone')


@admin.register(TaxRate)
class TaxRateAdmin(admin.ModelAdmin):
    list_display = ('name', 'rate', 'is_active')
    list_filter = ('is_active',)


@admin.register(Invoice)
class InvoiceAdmin(admin.ModelAdmin):
    list_display = ('invoice_number', 'party', 'invoice_type', 'issue_date', 'status', 'total')
    list_filter = ('invoice_type', 'status')
    search_fields = ('invoice_number', 'party__name')
    date_hierarchy = 'issue_date'


@admin.register(InvoiceLine)
class InvoiceLineAdmin(admin.ModelAdmin):
    list_display = ('invoice', 'line_no', 'description', 'quantity', 'unit_price', 'amount')
    list_select_related = ('invoice', 'account', 'tax_rate')


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = ('id', 'payment_date', 'party', 'direction', 'amount', 'method', 'reference')
    list_filter = ('direction', 'method')
    search_fields = ('reference', 'party__name')
    date_hierarchy = 'payment_date'


@admin.register(FiscalPeriod)
class FiscalPeriodAdmin(admin.ModelAdmin):
    list_display = ('name', 'start_date', 'end_date', 'is_closed')
    list_filter = ('is_closed',)


@admin.register(Budget)
class BudgetAdmin(admin.ModelAdmin):
    list_display = ('account', 'period_start', 'period_end', 'amount')
    list_filter = ('account',)
