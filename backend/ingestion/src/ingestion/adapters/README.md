# Adapters

Concrete implementations of the `src/ingestion/shared/` interfaces. Selected
per channel in `ingestion.module.ts` via `MAIL_TRANSPORT` / `BLOB_TRANSPORT` /
`SFTP_TRANSPORT`, with `INGESTION_PROFILE` providing the defaults.

## `local/` — filesystem transports (profile default: `local`)

No external infra. Used for dev, the E2E suite, and offline demos.

| File                      | Implements                         | Backing store              |
| ------------------------- | ---------------------------------- | -------------------------- |
| `local-blob-uploader.ts`  | `BlobUploadClient`                 | `LOCAL_STORAGE_DIR`        |
| `local-mail.client.ts`    | `MailClient`                       | `LOCAL_MAILDIR`            |
| `local-sftp.client.ts`    | `SftpClient` / `SftpClientFactory` | `LOCAL_SFTP_DIR`           |

## `prod/` — real transports

Each validates its own credentials at construction and throws at boot if
they're missing (see `NEEDS.md`).

| File                      | Implements                         | Transport                  | When |
| ------------------------- | ---------------------------------- | -------------------------- | ---- |
| `imap-mail.client.ts`     | `MailClient`                       | IMAP (dummy Gmail inbox)   | DEMO phase (`MAIL_TRANSPORT=imap`) |
| `oci-par-blob-uploader.ts`| `BlobUploadClient`                 | OCI bucket via PAR URL     | DEMO phase (`BLOB_TRANSPORT=par`) |
| `sharepoint-blob-uploader.ts` (+ `graph-drive.client.ts`) | `BlobUploadClient` | SharePoint / OneDrive drive via Microsoft Graph | `BLOB_TRANSPORT=sharepoint` (needs an app reg + `SP_DRIVE_ID`; a share link will NOT work) |
| `http-blob-uploader.ts`   | `BlobUploadClient`                 | Backend document HTTP API  | When Aman wires the backend (`BLOB_TRANSPORT=http`) |
| `graph-mail.client.ts`    | `MailClient`                       | Microsoft Graph (app-only) | Future M365 production (`MAIL_TRANSPORT=graph`) |
| `ssh2-sftp.client.ts`     | `SftpClient` / `SftpClientFactory` | `ssh2-sftp-client`         | Future real SFTP server (`SFTP_TRANSPORT=ssh2`) |

The interfaces in `src/ingestion/shared/` are the only contract — the
ingestion services don't know (and don't want to know) anything about the
transport.
