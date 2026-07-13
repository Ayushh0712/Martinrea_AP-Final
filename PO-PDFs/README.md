# PO-PDFs drop folder

Drop purchase-order PDFs here and the workflow backend uploads them to the
OCI bucket's `PO-PDFs/` folder automatically (checked every 30 seconds, or
instantly via the "Sync POs from OCI" button on the Side by Side View page).

## Naming convention (important)

The filename **is** the link to the purchase order — name each PDF exactly
after its PO number:

| PO number | File to drop here |
| --------- | ----------------- |
| PO-001    | `PO-001.pdf`      |
| PO-2001   | `PO-2001.pdf`     |

The app fetches the document by that name when you click "View PDF" on a PO
in the Side by Side View. A PDF whose name doesn't match any PO's `po_number`
is still uploaded, but nothing will link to it.

## What happens after upload

Successfully uploaded files are moved into the local [`uploaded/`](uploaded/)
subfolder (kept as your archive, never re-uploaded). Files that fail to
upload stay here and are retried on the next tick — check the workflow
service logs if a file never moves.

## Notes

- Only `.pdf` files are picked up; anything else is ignored.
- The PO's *data* comes separately: upload its `.json` to the bucket's
  `PO-JSON/` folder (see the main project docs). PDF and JSON are independent.
- Configuration lives in `backend/workflow/.env` — `PO_PDF_LOCAL_DIR`,
  `PO_PDF_LOCAL_SYNC_ENABLED`, `PO_PDF_LOCAL_SYNC_CRON`. Uploads require the
  `OCI_PAR_URL` PAR to permit object reads **and writes**.
