'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { FilePlus2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCreateInvoice } from '@/hooks/useInvoiceMutations';
import {
  CURRENCIES,
  INGESTION_CHANNELS,
  PLANTS,
} from '@/lib/constants';

const schema = z.object({
  invoiceNumber: z
    .string()
    .min(1, 'Required')
    .max(100, 'Max 100 characters'),
  supplierName: z
    .string()
    .min(1, 'Required')
    .max(255, 'Max 255 characters'),
  supplierId: z.string().max(50).optional().or(z.literal('')),
  poNumber: z.string().max(60).optional().or(z.literal('')),
  totalAmount: z.coerce
    .number({ invalid_type_error: 'Enter a number' })
    .min(0.01, 'Must be greater than 0'),
  currency: z.enum(CURRENCIES).default('USD'),
  ingestionChannel: z.enum(INGESTION_CHANNELS).default('MANUAL'),
  plantId: z.string().min(1, 'Choose a plant'),
});

type FormData = z.infer<typeof schema>;

export function CreateInvoiceModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const createInvoice = useCreateInvoice();

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      currency: 'USD',
      ingestionChannel: 'MANUAL',
      plantId: PLANTS[0].id,
    },
  });

  // Reset when modal closes
  useEffect(() => {
    if (!open) {
      reset({
        currency: 'USD',
        ingestionChannel: 'MANUAL',
        plantId: PLANTS[0].id,
      });
    }
  }, [open, reset]);

  const onSubmit = handleSubmit(async (data) => {
    const created = await createInvoice
      .mutateAsync({
        invoiceNumber: data.invoiceNumber,
        supplierName: data.supplierName,
        supplierId: data.supplierId || undefined,
        poNumber: data.poNumber || undefined,
        totalAmount: data.totalAmount,
        currency: data.currency,
        ingestionChannel: data.ingestionChannel,
        plantId: data.plantId,
      })
      .catch(() => null);
    if (created) {
      onOpenChange(false);
      router.push(`/invoices/${created.id}`);
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand">
              <FilePlus2 className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle>Create new invoice</DialogTitle>
              <DialogDescription>
                Captures the invoice header and queues it through OCR review.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Invoice number"
              error={errors.invoiceNumber?.message}
              required
            >
              <Input
                {...register('invoiceNumber')}
                placeholder="INV-2026-00184"
                autoFocus
              />
            </Field>
            <Field
              label="PO number"
              error={errors.poNumber?.message}
            >
              <Input {...register('poNumber')} placeholder="PO-44211" />
            </Field>
          </div>

          <div className="grid grid-cols-[1fr_180px] gap-3">
            <Field
              label="Supplier name"
              error={errors.supplierName?.message}
              required
            >
              <Input
                {...register('supplierName')}
                placeholder="e.g. Acme Components Ltd"
              />
            </Field>
            <Field
              label="Supplier ID"
              error={errors.supplierId?.message}
            >
              <Input
                {...register('supplierId')}
                placeholder="SUP-001"
              />
            </Field>
          </div>

          <div className="grid grid-cols-[1fr_120px] gap-3">
            <Field
              label="Total amount"
              error={errors.totalAmount?.message}
              required
            >
              <Input
                type="number"
                step="0.01"
                {...register('totalAmount')}
                placeholder="12500.00"
              />
            </Field>
            <Field label="Currency">
              <Select
                value={watch('currency')}
                onValueChange={(v) => setValue('currency', v as FormData['currency'])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Plant" error={errors.plantId?.message} required>
              <Select
                value={watch('plantId')}
                onValueChange={(v) => setValue('plantId', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLANTS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Channel">
              <Select
                value={watch('ingestionChannel')}
                onValueChange={(v) =>
                  setValue(
                    'ingestionChannel',
                    v as FormData['ingestionChannel'],
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INGESTION_CHANNELS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating…' : 'Create invoice'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  error,
  required,
  children,
}: {
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-[12.5px]">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </Label>
      {children}
      {error && <p className="text-[12px] text-red-600">{error}</p>}
    </div>
  );
}
