import { Global, Module } from '@nestjs/common';
import { ConfidenceService } from './confidence.service';
import { ExtractorService } from './extractor.service';
import { OcrService } from './ocr.service';
import { DocumentTypeDetector } from './parser/document-type.detector';
import { LanguageDetector } from './parser/language.detector';
import { OcrParserService } from './parser/ocr-parser.service';

@Global()
@Module({
  providers: [
    OcrService,
    ExtractorService,
    ConfidenceService,
    LanguageDetector,
    DocumentTypeDetector,
    OcrParserService,
  ],
  exports: [
    OcrService,
    ExtractorService,
    ConfidenceService,
    LanguageDetector,
    DocumentTypeDetector,
    OcrParserService,
  ],
})
export class OcrModule {}
