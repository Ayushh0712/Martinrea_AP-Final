# Mock Purchase Order and Invoice Structure

## Mock Purchase Order

Use this as the standard purchase order shape for testing the AP workflow.

```ts
{
  poNumber: 'PO-1001',
  supplierCode: 'SUP-001',
  supplierId: 'EIN-12-3456789', // or supplier master ID, but keep consistent
  supplierName: 'Acme Steel Co.',
  plantId: 'PLT-001',
  currency: 'USD',
  totalAmount: 5400.00,
  orderTotal: 5400.00,
  reservedAmount: 0.00,
  consumedAmount: 0.00,
  status: 'OPEN',
  issuedDate: '2026-01-10',
  expectedDeliveryDate: '2026-02-10',
  instanceId: 'ERP-INST-001',
  notes: 'Hot-rolled steel coils - Q1 order',
  lines: [
    {
      lineNumber: 1,
      itemCode: 'STL-HR-0.25x48',
      description: 'Hot-rolled steel coil 0.25 x 48 wide',
      orderQuantity: 15,
      reservedQuantity: 0,
      consumedQuantity: 0,
      unitOfMeasure: 'MT',
      unitPrice: 270.0000,
      lineTotal: 4050.00,
      status: 'OPEN'
    }
  ]
}
```

### Most Important PO Fields For Matching

The matcher primarily depends on:

- `poNumber`
- `supplierName`
- `currency`
- `totalAmount`
- Line `itemCode`
- Line `orderQuantity`
- Line `reservedQuantity`
- Line `consumedQuantity`
- Line `unitPrice`

## Mock Invoice

Use this as the standard invoice shape for testing the AP workflow.

```ts
{
  invoiceNumber: 'INV-2026-001',
  supplierName: 'Acme Steel Co.',
  supplierId: 'SUP-001',
  supplierTaxId: 'EIN-12-3456789',
  poNumber: 'PO-1001',
  purchaseOrderId: '<resolved PO UUID if seeding directly>',
  invoiceDate: '2026-01-18',
  dueDate: '2026-02-17',
  subtotal: 5000.00,
  discount: 100.00,
  taxAmount: 500.00,
  totalAmount: 5400.00,
  currency: 'USD',
  billToName: 'Martinrea Plant - Windsor',
  paymentTerm: 'Net 30',
  ingestionChannel: 'EMAIL',
  plantId: 'PLT-001',
  status: 'PENDING_MATCH',
  cfdiValid: null,
  lines: [
    {
      lineNumber: 1,
      itemCode: 'STL-HR-0.25x48',
      description: 'Hot-rolled steel coil 0.25 x 48 wide',
      skuOrPartNumber: 'STL-HR-0.25x48 / SKU-10011',
      quantity: 15,
      unitOfMeasure: 'MT',
      unitPrice: 270.0000,
      lineTotal: 4050.00
    }
  ]
}
```

### Most Important Invoice Fields For Matching

The matcher primarily depends on:

- `invoiceNumber`
- `supplierName`
- `poNumber`
- `currency`
- `totalAmount`
- Line `itemCode`
- Line `quantity`
- Line `unitPrice`

## Testing Notes

- Keep `supplierName` identical between the invoice and purchase order when testing successful matches.
- Keep `currency` identical between the invoice and purchase order when testing successful matches.
- Match invoice lines to PO lines through `itemCode`.
- A line can only draw down the remaining PO quantity: `orderQuantity - reservedQuantity - consumedQuantity`.
- Use `reservedAmount`, `consumedAmount`, `reservedQuantity`, and `consumedQuantity` to test partial draw-down and multiple invoices against the same PO.
- Keep supplier identifiers consistent. Prefer `supplierCode` for values like `SUP-001` and `supplierTaxId` or tax-ID fields for values like `EIN-12-3456789`.
