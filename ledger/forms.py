"""Django forms for creating invoices and recording payments."""
from django import forms

from .models import Account, Invoice, Party, Payment, TaxRate

# Accounts usable on an invoice line (exclude the AR/AP/VAT control accounts)
LINE_ACCOUNTS = Account.objects.filter(is_active=True).exclude(code__in=['1100', '2000', '2100'])


class InvoiceLineForm(forms.Form):
    description = forms.CharField(max_length=255)
    account = forms.ModelChoiceField(queryset=LINE_ACCOUNTS, empty_label='-- account --')
    quantity = forms.DecimalField(max_digits=15, decimal_places=3, initial=1, min_value=0)
    unit_price = forms.DecimalField(max_digits=20, decimal_places=2, initial=0, min_value=0)


class InvoiceForm(forms.Form):
    invoice_number = forms.CharField(max_length=50)
    party = forms.ModelChoiceField(queryset=Party.objects.all())
    invoice_type = forms.ChoiceField(choices=Invoice.Type.choices)
    issue_date = forms.DateField(widget=forms.DateInput(attrs={'type': 'date'}))
    due_date = forms.DateField(widget=forms.DateInput(attrs={'type': 'date'}))
    tax_rate = forms.ModelChoiceField(queryset=TaxRate.objects.filter(is_active=True), required=False)


class PaymentForm(forms.Form):
    payment_date = forms.DateField(widget=forms.DateInput(attrs={'type': 'date'}))
    party = forms.ModelChoiceField(queryset=Party.objects.all())
    direction = forms.ChoiceField(choices=Payment.Direction.choices)
    amount = forms.DecimalField(max_digits=20, decimal_places=2, min_value=0)
    method = forms.ChoiceField(choices=Payment.Method.choices, initial='bank')
    reference = forms.CharField(max_length=100, required=False)
    invoice = forms.ModelChoiceField(
        queryset=Invoice.objects.filter(status='issued').order_by('-issue_date'),
        required=False,
        help_text='Optional: allocate this payment to an unpaid invoice.',
    )
