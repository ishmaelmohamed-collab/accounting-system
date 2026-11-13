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
});

export const postEntrySchema = z.object({
  date: z.string().min(1),
  reference: z.string().optional().default(''),
  description: z.string().optional().default(''),
  idempotencyKey: z.string().nullable().optional(),
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
  invoiceNumber: z.string().min(1),
  partyId: z.number().int().positive(),
  invoiceType: z.enum(['sale', 'purchase']),
  issueDate: z.string().min(1),
  dueDate: z.string().min(1),
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
});

export const reverseEntrySchema = z.object({
  entryId: z.number().int().positive(),
});
