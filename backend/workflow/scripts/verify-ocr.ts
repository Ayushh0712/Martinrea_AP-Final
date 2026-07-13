/**
 * Throwaway verification harness: runs the real OCR pipeline
 * (OcrService.recognize -> OcrParserService.parse) against invoice files and
 * prints every extracted field, so the extraction quality can be eyeballed
 * without booting the whole Nest app.
 *
 * Usage: npx ts-node -T scripts/verify-ocr.ts <file> [file...]
 */
import { ConfigService } from '@nestjs/config';
import { OcrService } from '../src/ocr-app/ocr/ocr.service';
import { OcrParserService } from '../src/ocr-app/ocr/parser/ocr-parser.service';
import { ExtractorService } from '../src/ocr-app/ocr/extractor.service';
import { ConfidenceService } from '../src/ocr-app/ocr/confidence.service';
import { LanguageDetector } from '../src/ocr-app/ocr/parser/language.detector';
import { DocumentTypeDetector } from '../src/ocr-app/ocr/parser/document-type.detector';

async function main(): Promise<void> {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error('usage: npx ts-node -T scripts/verify-ocr.ts <file> [file...]');
    process.exit(1);
  }

  const config = new ConfigService({
    ocr: { language: 'eng', maxConcurrency: 2, confidenceThreshold: 80 },
  });
  const ocr = new OcrService(config);
  const parser = new OcrParserService(
    new ExtractorService(),
    new ConfidenceService(config),
    new LanguageDetector(),
    new DocumentTypeDetector(),
  );

  for (const file of files) {
    console.log(`\n================ ${file} ================`);
    try {
      const result = await ocr.recognize(file);
      console.log(
        `[ocr] confidence=${result.confidence.toFixed(1)} tokens=${result.tokens?.length ?? 0} textChars=${result.text.length}`,
      );
      const parsed = parser.parse({
        rawText: result.text,
        ocrConfidence: result.confidence,
        tokens: result.tokens,
      });
      console.log(`  supplierName   : ${parsed.supplierName}`);
      console.log(`  supplierTaxId  : ${parsed.supplierTaxId}`);
      console.log(`  invoiceNumber  : ${parsed.invoiceNumber}`);
      console.log(`  invoiceDate    : ${parsed.invoiceDate}`);
      console.log(`  poNumber       : ${parsed.poNumber}`);
      console.log(`  currency       : ${parsed.currency}`);
      console.log(`  subtotal       : ${parsed.subtotal}`);
      console.log(`  taxAmount      : ${parsed.taxAmount}`);
      console.log(`  totalAmount    : ${parsed.totalAmount}`);
      console.log(`  confidenceScore: ${parsed.confidenceScore}`);
      console.log(`  requiresReview : ${parsed.requiresReview} (${parsed.reviewReason})`);
      console.log(`  documentType   : ${parsed.documentType}  language: ${parsed.language}`);
      console.log(`  lineItems (${parsed.lineItems.length}):`);
      for (const li of parsed.lineItems) {
        console.log(
          `    - [${li.itemCode ?? '-'}] "${li.description}" qty=${li.quantity} unit=${li.unitPrice} total=${li.lineTotal}`,
        );
      }
    } catch (err) {
      console.error(`  FAILED: ${(err as Error).message}`);
    }
  }
}

void main();
