import {
  Column,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';

interface ExtractedLineItem {
  lineNumber: number;
  description?: string;
  skuOrPartNumber?: string;
  quantity?: number;
  unitPrice?: number;
  lineTotal?: number;
}

/**
 * Structured OCR extraction result for an invoice, including per-field
 * confidence scores and human-verification metadata. One record per invoice.
 */
@Table({
  tableName: 'ocr_results',
  timestamps: true,
  underscored: true,
})
export class OcrResult extends Model<OcrResult> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.UUID, allowNull: false, unique: true })
  declare invoiceId: string;

  @Column({ type: DataType.STRING(120), allowNull: true })
  declare extractionEngine: string | null;

  @Column({ type: DataType.STRING(120), allowNull: true })
  declare modelVersion: string | null;

  @Column({ type: DataType.JSONB, allowNull: true })
  declare rawResponse: Record<string, unknown> | null;

  @Column({ type: DataType.STRING(100), allowNull: true })
  declare extractedInvoiceNumber: string | null;

  @Column({ type: DataType.STRING(255), allowNull: true })
  declare extractedSupplierName: string | null;

  @Column({ type: DataType.STRING(60), allowNull: true })
  declare extractedPoNumber: string | null;

  @Column({ type: DataType.DECIMAL(16, 2), allowNull: true })
  declare extractedTotalAmount: number | null;

  @Column({ type: DataType.DECIMAL(16, 2), allowNull: true })
  declare extractedTaxAmount: number | null;

  @Column({ type: DataType.DATEONLY, allowNull: true })
  declare extractedInvoiceDate: string | null;

  @Column({ type: DataType.JSONB, allowNull: true })
  declare extractedLineItems: ExtractedLineItem[] | null;

  @Column({ type: DataType.FLOAT, allowNull: true })
  declare confidenceInvoiceNum: number | null;

  @Column({ type: DataType.FLOAT, allowNull: true })
  declare confidenceSupplier: number | null;

  @Column({ type: DataType.FLOAT, allowNull: true })
  declare confidencePoNumber: number | null;

  @Column({ type: DataType.FLOAT, allowNull: true })
  declare confidenceAmount: number | null;

  @Column({ type: DataType.FLOAT, allowNull: true })
  declare overallConfidence: number | null;

  @Default(false)
  @Column({ type: DataType.BOOLEAN, allowNull: false })
  declare requiresHumanReview: boolean;

  @Column({ type: DataType.STRING(10), allowNull: true })
  declare languageDetected: string | null;

  @Column({ type: DataType.STRING(40), allowNull: true })
  declare documentType: string | null;

  @Default(false)
  @Column({ type: DataType.BOOLEAN, allowNull: false })
  declare humanVerified: boolean;

  @Column({ type: DataType.DATE, allowNull: true })
  declare humanVerifiedAt: Date | null;

  @Column({ type: DataType.UUID, allowNull: true })
  declare humanVerifiedBy: string | null;
}
