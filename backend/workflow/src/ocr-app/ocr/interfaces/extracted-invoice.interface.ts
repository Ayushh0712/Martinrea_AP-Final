export interface ExtractedLineItem {
  itemCode: string | null;
  description: string | null;
  quantity: number | null;
  unitPrice: number | null;
  lineTotal: number | null;
}

export interface ExtractedField<T = string | number | null> {
  value: T;
  confidence: number; // 0..100
}

export interface ExtractedInvoice {
  supplier_name: string | null;
  supplier_tax_id: string | null;
  invoice_number: string | null;
  invoice_date: string | null; // ISO YYYY-MM-DD
  po_number: string | null;
  currency: string | null;
  subtotal: number | null;
  tax_amount: number | null;
  total_amount: number | null;
  confidence_score: number;
  requires_review: boolean;
  status: string;
  line_items: ExtractedLineItem[];
  /**
   * Per-field confidences used to compute `confidence_score`.
   */
  field_confidences: Record<string, number>;
}
