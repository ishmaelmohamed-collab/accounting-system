import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';

export function validate(schema: z.ZodTypeAny) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    req.body = result.data;
    return next();
  };
}

export const journalLineSchema = z.object({
  accountCode: z.string().min(1),
  lineType: z.enum(['debit', 'credit']),
  amount: z.union([z.string(), z.number()]),
  partyId: z.number().nullable().optional(),
  departmentId: z.number().int().positive().nullable().optional(),
});

export const postEntrySchema = z.object({
  date: z.string().min(1),
  reference: z.string().optional().default(''),
  description: z.string().optional().default(''),
  idempotencyKey: z.string().nullable().optional(),
  status: z.enum(['draft', 'posted']).optional().default('posted'),
  lines: z.array(journalLineSchema).min(1),
});

export const invoiceLineSchema = z.object({
  description: z.string().min(1),
  accountCode: z.string().min(1),
  quantity: z.number().optional().default(1),
  unitPrice: z.number().optional().default(0),
  amount: z.union([z.string(), z.number()]),
});

export const createInvoiceSchema = z.object({
  invoiceNumber: z.string().optional().nullable(),
  partyId: z.number().int().positive(),
  invoiceType: z.enum(['sale', 'purchase']),
  issueDate: z.string().min(1),
  dueDate: z.string().optional().nullable(),
  paymentTermId: z.number().int().positive().nullable().optional(),
  taxRateId: z.number().nullable().optional(),
  lines: z.array(invoiceLineSchema).min(1),
});

export const allocationSchema = z.object({
  invoiceId: z.number().int().positive(),
  amount: z.union([z.string(), z.number()]),
});

export const recordPaymentSchema = z.object({
  paymentDate: z.string().min(1),
  partyId: z.number().int().positive(),
  direction: z.enum(['incoming', 'outgoing']),
  amount: z.union([z.string(), z.number()]),
  method: z.string().optional().default('bank'),
  reference: z.string().optional().default(''),
  allocations: z.array(allocationSchema).optional(),
});

export const partySchema = z.object({
  name: z.string().min(1),
  type: z.enum(['customer', 'vendor', 'both']).optional().default('customer'),
  email: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  groupId: z.number().int().positive().nullable().optional(),
  paymentTermId: z.number().int().positive().nullable().optional(),
});

export const reverseEntrySchema = z.object({
  entryId: z.number().int().positive(),
});

export const departmentSchema = z.object({
  name: z.string().min(1),
});

export const fixedAssetSchema = z.object({
  name: z.string().min(1),
  accountId: z.number().int().positive(),
  purchaseDate: z.string().min(1),
  cost: z.union([z.string(), z.number()]),
  salvageValue: z.union([z.string(), z.number()]).optional().default('0'),
  usefulLifeYears: z.number().int().positive(),
});

export const inventoryItemSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  unit: z.string().optional().default('each'),
});

export const stockMovementSchema = z.object({
  itemId: z.number().int().positive(),
  movementDate: z.string().min(1),
  quantity: z.union([z.string(), z.number()]),
  unitCost: z.union([z.string(), z.number()]),
  reference: z.string().optional(),
});

export const bankTransactionSchema = z.object({
  accountId: z.number().int().positive(),
  transactionDate: z.string().min(1),
  description: z.string().min(1),
  amount: z.union([z.string(), z.number()]),
  reference: z.string().optional(),
});

export const recurringEntrySchema = z.object({
  description: z.string().min(1),
  frequency: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']),
  nextRunDate: z.string().min(1),
  lines: z.array(z.object({
    accountCode: z.string().min(1),
    lineType: z.enum(['debit', 'credit']),
    amount: z.union([z.string(), z.number()]),
    description: z.string().optional(),
  })).min(1),
});

export const closeYearSchema = z.object({
  year: z.number().int().min(2000).max(2100),
});

export const noteSchema = z.object({
  partyId: z.number().int().positive(),
  noteType: z.enum(['credit', 'debit']),
  issueDate: z.string().min(1),
  reason: z.string().optional().nullable(),
  invoiceId: z.number().int().positive().nullable().optional(),
  subtotal: z.union([z.string(), z.number()]),
  taxRateId: z.number().int().positive().nullable().optional(),
  noteNumber: z.string().optional(),
  accountCode: z.string().optional(),
});

export const orderLineSchema = z.object({
  description: z.string().min(1),
  accountCode: z.string().min(1),
  quantity: z.number().optional().default(1),
  unitPrice: z.number().optional().default(0),
  amount: z.union([z.string(), z.number()]),
});

export const orderSchema = z.object({
  orderType: z.enum(['purchase', 'sale']),
  partyId: z.number().int().positive(),
  orderDate: z.string().min(1),
  expectedDate: z.string().nullable().optional(),
  status: z.enum(['draft', 'confirmed', 'billed', 'cancelled']).optional().default('confirmed'),
  taxRateId: z.number().int().positive().nullable().optional(),
  orderNumber: z.string().optional(),
  lines: z.array(orderLineSchema).min(1),
});

export const disposeAssetSchema = z.object({
  assetId: z.number().int().positive(),
  date: z.string().min(1),
  proceeds: z.union([z.string(), z.number()]).optional().default('0'),
  method: z.string().optional().default('sale'),
});

export const approveEntrySchema = z.object({
  entryId: z.number().int().positive(),
});

export const importAccountsSchema = z.object({
  csv: z.string().min(1),
});

export const importBalancesSchema = z.object({
  csv: z.string().min(1),
  date: z.string().min(1),
});

export const attachmentSchema = z.object({
  entityType: z.string().min(1),
  entityId: z.number().int().positive().nullable().optional(),
  filename: z.string().min(1),
  contentType: z.string().optional().default('application/octet-stream'),
  contentBase64: z.string().min(1),
});

export const prepaymentSchema = z.object({
  description: z.string().min(1),
  accountCode: z.string().min(1),
  totalAmount: z.union([z.string(), z.number()]),
  months: z.number().int().positive(),
  startDate: z.string().min(1),
});

export const amortizeSchema = z.object({
  asOfDate: z.string().min(1),
});

export const userSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(6),
  role: z.enum(['admin', 'accountant', 'viewer']).default('viewer'),
});

export const partyGroupSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
});

export const paymentTermSchema = z.object({
  name: z.string().min(1),
  days: z.number().int().min(0),
  description: z.string().optional().nullable(),
});

export const bomLineSchema = z.object({
  componentItemId: z.number().int().positive(),
  quantity: z.union([z.string(), z.number()]),
});

export const bomSchema = z.object({
  finishedItemId: z.number().int().positive(),
  name: z.string().min(1),
  lines: z.array(bomLineSchema).min(1),
});

export const productionOrderSchema = z.object({
  bomId: z.number().int().positive(),
  quantity: z.union([z.string(), z.number()]),
  productionDate: z.string().min(1),
});

export const completeProductionSchema = z.object({
  orderId: z.number().int().positive(),
});
