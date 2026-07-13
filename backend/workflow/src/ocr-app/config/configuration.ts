// NOTE: This config is merged into the workflow-service ConfigModule alongside
// the main configuration.ts. Keys that the workflow config already owns
// (port, nodeEnv, jwt) are intentionally omitted here so they are not
// clobbered. Only OCR-specific namespaces are contributed.
export interface OcrAppConfig {
  appName: string;
  /**
   * OBSOLETE: was the Prisma connection string for the OCR `ocr` schema.
   * OCR persistence now rides the shared Sequelize connection (DB_* vars),
   * so nothing reads this anymore. Kept only to avoid breaking env parsing.
   */
  database: {
    url: string;
  };
  redis: {
    host: string;
    port: number;
    password?: string;
  };
  admin: {
    username: string;
    password: string;
  };
  upload: {
    dir: string;
    maxFileSizeMB: number;
  };
  ocr: {
    language: string;
    maxRetries: number;
    confidenceThreshold: number;
    /** Absolute path to the tesseract binary. Empty = resolve from PATH. */
    binaryPath: string;
    /** Tesseract page segmentation mode (--psm). */
    psm: number;
    /** Tesseract OCR engine mode (--oem). */
    oem: number;
    /** Run sharp preprocessing before OCR. */
    preprocess: boolean;
    /** Max concurrent tesseract processes. */
    maxConcurrency: number;
    /**
     * Directory holding the *.traineddata models. When unset, Tesseract uses
     * its compiled-in default (e.g. brew/apk location). In Docker this points
     * at the high-accuracy tessdata_best models via TESSDATA_PREFIX.
     */
    tessdataDir?: string;
  };
  oci: {
    parUrl: string;
  };
  sharePoint: {
    tenantId: string;
    clientId: string;
    clientSecret: string;
    driveId: string;
    rootFolder: string;
  };
}

export default (): OcrAppConfig => ({
  appName: process.env.APP_NAME ?? 'AI-Invoice-OCR',
  database: {
    url: process.env.DATABASE_URL ?? '',
  },
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },
  admin: {
    username: process.env.ADMIN_USERNAME ?? 'admin',
    password: process.env.ADMIN_PASSWORD ?? 'admin123',
  },
  upload: {
    dir: process.env.UPLOAD_DIR ?? './uploads',
    maxFileSizeMB: parseInt(process.env.MAX_FILE_SIZE_MB ?? '10', 10),
  },
  ocr: {
    // 'eng+spa' = English + Spanish combined Tesseract pass. Requires the
    // Spanish traineddata file to be present (Tesseract.js downloads it on
    // first use to <tessdata-dir>/spa.traineddata.gz). Override via env if
    // Spanish OCR is not needed in a deployment.
    language: process.env.OCR_LANGUAGE ?? 'eng+spa',
    maxRetries: parseInt(process.env.OCR_MAX_RETRIES ?? '3', 10),
    confidenceThreshold: parseInt(process.env.CONFIDENCE_THRESHOLD ?? '80', 10),
    // Empty string => node-tesseract-ocr / execFile resolve `tesseract` from PATH.
    binaryPath: process.env.OCR_TESSERACT_PATH ?? '',
    psm: parseInt(process.env.OCR_PSM ?? '3', 10),
    oem: parseInt(process.env.OCR_OEM ?? '1', 10),
    preprocess: (process.env.OCR_PREPROCESS ?? 'true').toLowerCase() !== 'false',
    maxConcurrency: parseInt(process.env.OCR_MAX_CONCURRENCY ?? '2', 10),
    tessdataDir: process.env.OCR_TESSDATA_DIR || process.env.TESSDATA_PREFIX || undefined,
  },
  oci: {
    parUrl: process.env.OCI_PAR_URL ?? '',
  },
  sharePoint: {
    // SharePoint/OneDrive (Graph) source for the OCR poller. Credentials default
    // to the GRAPH_* app registration; SP_GRAPH_* override them if they diverge.
    tenantId: process.env.SP_GRAPH_TENANT_ID || process.env.GRAPH_TENANT_ID || '',
    clientId: process.env.SP_GRAPH_CLIENT_ID || process.env.GRAPH_CLIENT_ID || '',
    clientSecret: process.env.SP_GRAPH_CLIENT_SECRET || process.env.GRAPH_CLIENT_SECRET || '',
    driveId: process.env.SP_DRIVE_ID ?? '',
    rootFolder: process.env.SP_ROOT_FOLDER ?? 'AP-Ingestion',
  },
});
