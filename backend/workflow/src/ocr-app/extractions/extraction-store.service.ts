import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { ParsedInvoice } from '../ocr/parser/parsed-invoice.interface';

/**
 * A single OCR extraction held in memory (no DB write). Produced by the OCI
 * auto-ingest poller after OCR + parsing, and surfaced to the review UI.
 */
export interface StoredExtraction {
  /** Server-generated id for the transient record. */
  id: string;
  /** Full OCI object name (e.g. "AP-Accepted_Correct/inv-123.pdf"). */
  sourceObjectName: string;
  /** Basename shown to the user. */
  originalFilename: string;
  mimeType: string;
  fileSize: number;
  /** ISO timestamp of when the extraction ran. */
  extractedAt: string;
  /** Overall OCR engine confidence (0..100). */
  ocrConfidence: number;
  /** Pre-authenticated URL to view the original document, or null. */
  viewUrl: string | null;
  /** The parsed invoice fields (business shape, no raw OCR text). */
  fields: ParsedInvoice;
}

/** Fields the caller supplies; id + extractedAt are filled in by the store. */
export type NewExtraction = Omit<StoredExtraction, 'id' | 'extractedAt'>;

/**
 * In-memory store for OCR extractions.
 *
 * Persistence to the database is intentionally deferred (new seed files must be
 * integrated first), so results live only for the lifetime of the process and
 * are surfaced transiently to the review UI. Dedup uses the source object name
 * so a repeated bucket scan never re-processes the same document.
 */
@Injectable()
export class ExtractionStoreService {
  private readonly logger = new Logger(ExtractionStoreService.name);
  private readonly byId = new Map<string, StoredExtraction>();
  private readonly objectNames = new Set<string>();

  /** Store a freshly-parsed extraction and return the stored record. */
  add(entry: NewExtraction): StoredExtraction {
    const stored: StoredExtraction = {
      ...entry,
      id: randomUUID(),
      extractedAt: new Date().toISOString(),
    };
    this.byId.set(stored.id, stored);
    this.objectNames.add(entry.sourceObjectName);
    this.logger.log(
      `Stored extraction ${stored.id} for ${entry.originalFilename} ` +
        `(confidence=${Math.round(entry.ocrConfidence)})`,
    );
    return stored;
  }

  /** All extractions, most recent first. */
  list(): StoredExtraction[] {
    return [...this.byId.values()].sort((a, b) =>
      b.extractedAt.localeCompare(a.extractedAt),
    );
  }

  get(id: string): StoredExtraction | undefined {
    return this.byId.get(id);
  }

  /**
   * Remove a single extraction once it has been persisted to the database.
   * The source object name is intentionally kept in the dedup index so the OCI
   * poller does not re-ingest the file we just committed.
   */
  remove(id: string): boolean {
    const removed = this.byId.delete(id);
    if (removed) {
      this.logger.log(`Removed extraction ${id} (persisted to database)`);
    }
    return removed;
  }

  /** True when an object with this name has already been extracted. */
  hasObject(objectName: string): boolean {
    return this.objectNames.has(objectName);
  }

  /**
   * Record an object name in the dedup index without storing an extraction.
   * Used by the OCI poller to cache "already persisted to the database" hits
   * so the same file isn't re-checked against the DB on every scan tick.
   */
  markObject(objectName: string): void {
    this.objectNames.add(objectName);
  }

  /** Wipe all stored extractions (and the dedup index). */
  clear(): number {
    const count = this.byId.size;
    this.byId.clear();
    this.objectNames.clear();
    this.logger.log(`Cleared ${count} stored extraction(s)`);
    return count;
  }
}
