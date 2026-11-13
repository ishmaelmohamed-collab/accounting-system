export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
export type LineType = 'debit' | 'credit';
export type InvoiceType = 'sale' | 'purchase';
export type PaymentDirection = 'incoming' | 'outgoing';

export interface Account {
  id: number;
  code: string;
  name: string;
  type: AccountType;
  normal_balance: 'debit' | 'credit';
  is_active: boolean;
}

export interface JournalLineInput {
  accountCode: string;
  lineType: LineType;
  amount: string | number;
  partyId?: number | null;
}

export interface PostEntryArgs {
  date: string;
  reference?: string;
  description?: string;
  lines: JournalLineInput[];
  idempotencyKey?: string | null;
}

export interface InvoiceLineInput {
  description: string;
  accountCode: string;
  quantity?: number;
  unitPrice?: number;
  amount: string | number;
}

export interface CreateInvoiceArgs {
  invoiceNumber: string;
  partyId: number;
  invoiceType: InvoiceType;
  issueDate: string;
  dueDate: string;
  lines: InvoiceLineInput[];
  taxRateId?: number | null;
}

export interface PaymentAllocation {
  invoiceId: number;
  amount: string | number;
}

export interface RecordPaymentArgs {
  paymentDate: string;
  partyId: number;
  direction: PaymentDirection;
  amount: string | number;
  method?: string;
  reference?: string;
  allocations?: PaymentAllocation[];
}
