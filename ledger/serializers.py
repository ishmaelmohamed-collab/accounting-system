"""DRF serializers for the accounting API."""
from rest_framework import serializers

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


# ---------------------------------------------------------------------------
# Read serializers
# ---------------------------------------------------------------------------
class AccountSerializer(serializers.ModelSerializer):
    class Meta:
        model = Account
        fields = ['id', 'code', 'name', 'type', 'normal_balance', 'parent', 'description', 'is_active']


class PartySerializer(serializers.ModelSerializer):
    class Meta:
        model = Party
        fields = ['id', 'name', 'type', 'email', 'phone', 'address']


class TaxRateSerializer(serializers.ModelSerializer):
    class Meta:
        model = TaxRate
        fields = ['id', 'name', 'rate', 'is_active']


class FiscalPeriodSerializer(serializers.ModelSerializer):
    class Meta:
        model = FiscalPeriod
        fields = ['id', 'name', 'start_date', 'end_date', 'is_closed']


class BudgetSerializer(serializers.ModelSerializer):
    class Meta:
        model = Budget
        fields = ['id', 'account', 'period_start', 'period_end', 'amount']


class JournalEntryLineSerializer(serializers.ModelSerializer):
    account_code = serializers.CharField(source='account.code', read_only=True)

    class Meta:
        model = JournalEntryLine
        fields = ['id', 'account', 'account_code', 'line_type', 'amount', 'description', 'line_no', 'party']


class JournalEntrySerializer(serializers.ModelSerializer):
    lines = JournalEntryLineSerializer(many=True, read_only=True)

    class Meta:
        model = JournalEntry
        fields = ['id', 'entry_date', 'reference', 'description', 'status', 'posted_at', 'idempotency_key', 'reversal_of', 'lines']


class InvoiceLineSerializer(serializers.ModelSerializer):
    class Meta:
        model = InvoiceLine
        fields = ['id', 'description', 'account', 'quantity', 'unit_price', 'amount', 'tax_rate', 'line_no']


class InvoiceSerializer(serializers.ModelSerializer):
    lines = InvoiceLineSerializer(many=True, read_only=True)

    class Meta:
        model = Invoice
        fields = [
            'id', 'invoice_number', 'party', 'invoice_type', 'issue_date', 'due_date',
            'status', 'subtotal', 'tax_amount', 'total', 'notes', 'journal_entry', 'lines',
        ]


class PaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Payment
        fields = ['id', 'payment_date', 'party', 'direction', 'amount', 'method', 'reference', 'journal_entry']


class TrialBalanceRowSerializer(serializers.Serializer):
    code = serializers.CharField()
    name = serializers.CharField()
    type = serializers.CharField()
    debit = serializers.DecimalField(max_digits=20, decimal_places=2)
    credit = serializers.DecimalField(max_digits=20, decimal_places=2)


# ---------------------------------------------------------------------------
# Input serializers for the service-backed write endpoints
# ---------------------------------------------------------------------------
class JournalLineInputSerializer(serializers.Serializer):
    account = serializers.PrimaryKeyRelatedField(queryset=Account.objects.all())
    line_type = serializers.ChoiceField(choices=['debit', 'credit'])
    amount = serializers.DecimalField(max_digits=20, decimal_places=2)
    party = serializers.PrimaryKeyRelatedField(queryset=Party.objects.all(), required=False, allow_null=True)


class PostEntryInputSerializer(serializers.Serializer):
    entry_date = serializers.DateField()
    reference = serializers.CharField(required=False, allow_blank=True, default='')
    description = serializers.CharField(required=False, allow_blank=True, default='')
    idempotency_key = serializers.CharField(required=False, allow_null=True, default=None)
    lines = JournalLineInputSerializer(many=True)


class InvoiceLineInputSerializer(serializers.Serializer):
    description = serializers.CharField()
    account = serializers.PrimaryKeyRelatedField(queryset=Account.objects.all())
    quantity = serializers.DecimalField(max_digits=15, decimal_places=3, default=1)
    unit_price = serializers.DecimalField(max_digits=20, decimal_places=2)


class CreateInvoiceInputSerializer(serializers.Serializer):
    invoice_number = serializers.CharField()
    party = serializers.PrimaryKeyRelatedField(queryset=Party.objects.all())
    invoice_type = serializers.ChoiceField(choices=['sale', 'purchase'])
    issue_date = serializers.DateField()
    due_date = serializers.DateField()
    tax_rate = serializers.PrimaryKeyRelatedField(queryset=TaxRate.objects.all(), required=False, allow_null=True)
    lines = InvoiceLineInputSerializer(many=True)


class AllocationInputSerializer(serializers.Serializer):
    invoice = serializers.PrimaryKeyRelatedField(queryset=Invoice.objects.all())
    amount = serializers.DecimalField(max_digits=20, decimal_places=2)


class RecordPaymentInputSerializer(serializers.Serializer):
    payment_date = serializers.DateField()
    party = serializers.PrimaryKeyRelatedField(queryset=Party.objects.all())
    direction = serializers.ChoiceField(choices=['incoming', 'outgoing'])
    amount = serializers.DecimalField(max_digits=20, decimal_places=2)
    method = serializers.ChoiceField(choices=['cash', 'bank', 'mobile_money', 'other'], default='bank')
    reference = serializers.CharField(required=False, allow_blank=True, default='')
    allocations = AllocationInputSerializer(many=True, required=False)
