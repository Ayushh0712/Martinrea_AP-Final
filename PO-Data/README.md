# PO-Data drop folder

Drop purchase-order `.json` files here and the workflow backend reads them
directly into the database (`purchase_orders` + `purchase_order_lines`) —
checked every 30 seconds, or instantly via the "Sync POs from OCI" button on
the Side by Side View page. No OCI upload happens for these files.

## How re-reading works

Files **stay in this folder**. A file is read only when its last-modified
time changes:

- New file → ingested on first sight.
- Unchanged file → skipped (not even opened).
- Edited + saved file → re-ingested, and the PO rows update in place
  (upsert keyed on `poNumber` + `lineNumber`, so no duplicates).
- Invalid file → error logged once, then ignored until you fix and save it.

## File format

A single PO object or an array of them. Minimal working example
(`PO-3001.json` — the filename itself doesn't matter, only the content):

```json
[
  {
    "poNumber": "PO-3001",
    "supplierCode": "SUP-001",
    "supplierId": "EIN-12-3456789",
    "supplierName": "Acme Steel Co.",
    "plantId": "PLT-004",
    "currency": "USD",
    "totalAmount": 3994.29,
    "orderTotal": 3994.29,
    "status": "OPEN",
    "issuedDate": "2026-07-01",
    "expectedDeliveryDate": "2026-08-01",
    "notes": "Optional",
    "lines": [
      {
        "lineNumber": 1,
        "itemCode": "STL-HR-0.25x48",
        "description": "Hot-rolled steel coil 0.25 x 48 wide",
        "orderQuantity": 15,
        "unitOfMeasure": "MT",
        "unitPrice": 266.2863,
        "lineTotal": 3994.29,
        "status": "OPEN"
      }
    ]
  }
]
```

Required: `poNumber` and, per line, a numeric `lineNumber`. Everything else is
optional but `lines` with `itemCode`/`unitPrice`/`orderQuantity` are needed for
2-way matching to work. Same shape as
`backend/workflow/src/seeds/data/all_purchase_orders.json` — copy from there.

## Fields the ingest ignores on existing POs

The live draw-down state is owned by the app's match/approval flow (invoices
reserve and consume PO quantity/amount), so when a JSON file updates an
**existing** PO these fields are ignored rather than written:

- Header: `reservedAmount`, `consumedAmount`
- Lines: `reservedQuantity`, `consumedQuantity`
- `status` (header and lines) — derived from the draw-down. Exception: an
  explicit header `status` of `CLOSED` or `CANCELLED` IS applied (ERP signal).

This means re-saving a file (or restarting the service, which re-ingests all
files once) can never reset how much of a PO has already been invoiced.
Everything else — prices, quantities, dates, supplier, totals — updates
normally, so PO amendments work as before.

## Notes

- Only `.json` files are picked up; anything else is ignored.
- The PO's PDF document goes separately into the `PO-PDFs/` folder (named
  `<poNumber>.pdf`). Data and document are independent.
- Configuration lives in `backend/workflow/.env` — `PO_JSON_LOCAL_DIR`,
  `PO_JSON_LOCAL_SYNC_ENABLED`, `PO_JSON_LOCAL_SYNC_CRON`.
