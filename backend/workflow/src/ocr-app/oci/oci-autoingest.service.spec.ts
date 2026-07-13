import { OciAutoIngestService } from './oci-autoingest.service';
import { ExtractionStoreService } from '../extractions/extraction-store.service';

const DOC_PREFIX = 'AP-Accepted_Correct/';
const MARKER_PREFIX = 'ocr-processed/';

function doc(basename: string) {
  return { name: `${DOC_PREFIX}${basename}`, downloadUrl: 'http://par/x' };
}

function marker(basename: string) {
  return { name: `${MARKER_PREFIX}${basename}.json`, downloadUrl: 'http://par/m' };
}

function newService(opts: {
  docs?: Array<{ name: string }>;
  markers?: Array<{ name: string }>;
  markersFail?: boolean;
  dbFilenames?: string[];
}) {
  const putCalls: Array<{ name: string; body: string }> = [];

  const config = { get: jest.fn().mockReturnValue(undefined) };
  const oci = {
    listDocuments: jest.fn().mockResolvedValue(opts.docs ?? []),
    listObjects: jest.fn().mockImplementation(async () => {
      if (opts.markersFail) throw new Error('PAR listing failed');
      return { objects: opts.markers ?? [], prefixes: [] };
    }),
    putObject: jest.fn().mockImplementation(async (name: string, body: Buffer) => {
      putCalls.push({ name, body: body.toString() });
    }),
  };
  const files = { getSubfolderPath: jest.fn().mockReturnValue('/tmp') };
  const ocr = { recognize: jest.fn() };
  const parser = { parse: jest.fn() };
  const store = new ExtractionStoreService();
  const invoices = {
    existsByOriginalFilename: jest
      .fn()
      .mockImplementation(async (basename: string) =>
        (opts.dbFilenames ?? []).includes(basename),
      ),
  };

  const svc = new OciAutoIngestService(
    config as unknown as never,
    oci as unknown as never,
    files as unknown as never,
    ocr as unknown as never,
    parser as unknown as never,
    store as unknown as never,
    invoices as unknown as never,
  );

  return { svc, oci, store, invoices, putCalls };
}

describe('OciAutoIngestService.runScan (durable processed markers)', () => {
  test('document with a marker is skipped, cached, and never OCRed or DB-checked', async () => {
    const ctx = newService({
      docs: [doc('aaa-INV-1.pdf')],
      markers: [marker('aaa-INV-1.pdf')],
    });
    const ingest = jest.spyOn(ctx.svc, 'ingestObject').mockResolvedValue(undefined as never);

    const result = await ctx.svc.runScan();

    expect(result).toEqual({ ingested: 0, skipped: 1, scanned: 1 });
    expect(ingest).not.toHaveBeenCalled();
    expect(ctx.invoices.existsByOriginalFilename).not.toHaveBeenCalled();
    expect(ctx.putCalls).toHaveLength(0);
    // Cached in the in-memory index so later ticks short-circuit.
    expect(ctx.store.hasObject(`${DOC_PREFIX}aaa-INV-1.pdf`)).toBe(true);
  });

  test('document with a DB row but no marker is skipped and the marker is self-healed', async () => {
    const ctx = newService({
      docs: [doc('bbb-INV-2.pdf')],
      dbFilenames: ['bbb-INV-2.pdf'],
    });
    const ingest = jest.spyOn(ctx.svc, 'ingestObject').mockResolvedValue(undefined as never);

    const result = await ctx.svc.runScan();

    expect(result).toEqual({ ingested: 0, skipped: 1, scanned: 1 });
    expect(ingest).not.toHaveBeenCalled();
    expect(ctx.putCalls).toHaveLength(1);
    expect(ctx.putCalls[0].name).toBe(`${MARKER_PREFIX}bbb-INV-2.pdf.json`);
    expect(JSON.parse(ctx.putCalls[0].body)).toMatchObject({
      basename: 'bbb-INV-2.pdf',
      sourceObjectName: `${DOC_PREFIX}bbb-INV-2.pdf`,
    });
  });

  test('brand-new document is ingested', async () => {
    const ctx = newService({ docs: [doc('ccc-INV-3.pdf')] });
    const ingest = jest.spyOn(ctx.svc, 'ingestObject').mockResolvedValue(undefined as never);

    const result = await ctx.svc.runScan();

    expect(result).toEqual({ ingested: 1, skipped: 0, scanned: 1 });
    expect(ingest).toHaveBeenCalledWith(`${DOC_PREFIX}ccc-INV-3.pdf`, '.pdf');
    expect(ctx.putCalls).toHaveLength(0);
  });

  test('marker listing failure degrades gracefully to the DB check', async () => {
    const ctx = newService({
      docs: [doc('ddd-INV-4.pdf')],
      markersFail: true,
      dbFilenames: ['ddd-INV-4.pdf'],
    });
    const ingest = jest.spyOn(ctx.svc, 'ingestObject').mockResolvedValue(undefined as never);

    const result = await ctx.svc.runScan();

    expect(result).toEqual({ ingested: 0, skipped: 1, scanned: 1 });
    expect(ingest).not.toHaveBeenCalled();
    expect(ctx.invoices.existsByOriginalFilename).toHaveBeenCalledWith('ddd-INV-4.pdf');
  });

  test('markProcessed swallows upload failures (best-effort)', async () => {
    const ctx = newService({});
    ctx.oci.putObject.mockRejectedValueOnce(new Error('PAR expired'));
    await expect(ctx.svc.markProcessed('eee-INV-5.pdf')).resolves.toBeUndefined();
  });
});
