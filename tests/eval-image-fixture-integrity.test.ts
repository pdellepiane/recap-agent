import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';

import YAML from 'yaml';
import { describe, expect, it } from 'vitest';

import { MAX_IMAGE_BYTES, normalizeInboundImage } from '../src/core/inbound-image';

const REPO = process.cwd();

const READABLE_ASSET = 'evals/fixtures/images/receipt-readable-149-90.png';
const OBSCURED_ASSET = 'evals/fixtures/images/receipt-amount-obscured.png';
const READABLE_SHA256 = '15d3842a7e05e4538d15fb095891b5b3a2b4eea23915b49b42c49f62bb71001e';
const OBSCURED_SHA256 = 'b9070acd5d258ca1e3361ac05638b8de3e3db16f63fdc0b6538a2e335c2f630c';
const RECEIPT_340_44_ASSET = 'evals/fixtures/images/receipt-readable-340-44.png';
const RECEIPT_340_44_SHA256 = '672a8bd61eb295dfc0e938ba2d01d48a9d464cfdedaa1f410a5885609227c26f';

/**
 * Minimal independent PNG reader (RGB/RGBA, 8-bit): parses IHDR/IDAT/IEND,
 * inflates scanlines and reverses all five PNG filters. Independent from the
 * production decoder so the pixel assertions below verify visible content
 * rather than repeating the same code path.
 */
function readGrayscalePixels(raw: Buffer): { width: number; height: number; at: (x: number, y: number) => number } {
  if (!raw.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error('Not a PNG file.');
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  let seenIend = false;
  while (offset < raw.length) {
    const length = raw.readUInt32BE(offset);
    const type = raw.subarray(offset + 4, offset + 8).toString('ascii');
    const data = raw.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8] ?? 0;
      colorType = data[9] ?? 0;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      seenIend = true;
      break;
    }
    offset += 12 + length;
  }
  if (!seenIend) throw new Error('PNG lacks the IEND trailer.');
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`Unsupported PNG shape bitDepth=${bitDepth} colorType=${colorType}.`);
  }
  const channels = colorType === 2 ? 3 : 4;
  const stride = width * channels;
  const inflated = inflateSync(Buffer.concat(idat));
  // Reconstruct every data byte first (filters operate on bytes, not pixels).
  const rows: number[][] = [];
  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[pos] ?? 0;
    pos += 1;
    const row: number[] = new Array<number>(stride).fill(0);
    const prev = y > 0 ? rows[y - 1] : new Array<number>(stride).fill(0);
    for (let x = 0; x < stride; x += 1) {
      const filt = inflated[pos] ?? 0;
      pos += 1;
      const a = x >= channels ? row[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let value = filt;
      if (filter === 1) value = (filt + a) & 255;
      else if (filter === 2) value = (filt + b) & 255;
      else if (filter === 3) value = (filt + Math.floor((a + b) / 2)) & 255;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        value = (filt + predictor) & 255;
      }
      row[x] = value;
    }
    rows.push(row);
  }
  // Grayscale sample: for these synthetic black-on-white assets the red
  // channel alone separates ink from paper.
  const at = (x: number, y: number): number => {
    const row = rows[y];
    return row === undefined ? 255 : (row[x * channels] ?? 255);
  };
  return { width, height, at };
}

function darkCount(grid: { width: number; height: number; at: (x: number, y: number) => number }, box: [number, number, number, number]): number {
  const [x0, y0, x1, y1] = box;
  let count = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      if (grid.at(x, y) < 128) count += 1;
    }
  }
  return count;
}

function casePayload(caseFile: string, inputIndex?: number): string {
  const doc = YAML.parse(readFileSync(path.join(REPO, caseFile), 'utf8')) as {
    inputs?: Array<{ image?: { data?: unknown } }>;
  };
  const inputs = doc.inputs ?? [];
  const found = inputIndex === undefined
    ? inputs.find((input) => typeof input.image?.data === 'string')
    : inputs[inputIndex];
  if (!found?.image?.data || typeof found.image.data !== 'string') {
    throw new Error(`${caseFile} has no image.data payload.`);
  }
  return found.image.data;
}

describe('F1 image fixture integrity', () => {
  it('recorded assets decode with expected dimensions, hashes, and visible content', () => {
    // Readable receipt: recorded bytes, hash, dimensions, and byte limit.
    const raw = readFileSync(path.join(REPO, READABLE_ASSET));
    expect(raw.length).toBe(40976);
    expect(raw.length).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
    expect(createHash('sha256').update(raw).digest('hex')).toBe(READABLE_SHA256);
    const grid = readGrayscalePixels(raw);
    expect(grid.width).toBe(800);
    expect(grid.height).toBe(1000);
    // Amount value region and date value region both carry ink.
    expect(darkCount(grid, [217, 285, 410, 326])).toBeGreaterThan(200);
    expect(darkCount(grid, [198, 373, 410, 413])).toBeGreaterThan(200);
    const normalized = normalizeInboundImage({ data: raw.toString('base64'), mime_type: 'image/png' });
    expect(normalized.status).toBe('available');

    // 340.44 receipt: same recorded-shape checks plus its own ink regions.
    const receipt34044 = readFileSync(path.join(REPO, RECEIPT_340_44_ASSET));
    expect(receipt34044.length).toBe(45359);
    expect(receipt34044.length).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
    expect(createHash('sha256').update(receipt34044).digest('hex')).toBe(RECEIPT_340_44_SHA256);
    const receiptGrid = readGrayscalePixels(receipt34044);
    expect(receiptGrid.width).toBe(800);
    expect(receiptGrid.height).toBe(1000);
    // Title row and the S/ 340.44 amount value region both carry ink.
    expect(darkCount(receiptGrid, [95, 90, 705, 160])).toBeGreaterThan(200);
    expect(darkCount(receiptGrid, [300, 340, 600, 410])).toBeGreaterThan(200);
    const receiptNormalized = normalizeInboundImage({ data: receipt34044.toString('base64'), mime_type: 'image/png' });
    expect(receiptNormalized.status).toBe('available');

    // Obscured receipt: labels stay legible while amount and date values are solid ink.
    const obscured = readFileSync(path.join(REPO, OBSCURED_ASSET));
    expect(obscured.length).toBe(34099);
    expect(createHash('sha256').update(obscured).digest('hex')).toBe(OBSCURED_SHA256);
    const obscuredGrid = readGrayscalePixels(obscured);
    expect(obscuredGrid.width).toBe(800);
    expect(obscuredGrid.height).toBe(1000);
    const amountBox: [number, number, number, number] = [217, 285, 410, 326];
    const dateBox: [number, number, number, number] = [198, 373, 410, 413];
    const amountArea = (amountBox[2] - amountBox[0]) * (amountBox[3] - amountBox[1]);
    const dateArea = (dateBox[2] - dateBox[0]) * (dateBox[3] - dateBox[1]);
    // Value regions are fully blacked out: every pixel is ink.
    expect(darkCount(obscuredGrid, amountBox)).toBe(amountArea);
    expect(darkCount(obscuredGrid, dateBox)).toBe(dateArea);
    // The Monto: label column stays legible.
    expect(darkCount(obscuredGrid, [70, 281, 217, 330])).toBeGreaterThan(200);
    const obscuredNormalized = normalizeInboundImage({ data: obscured.toString('base64'), mime_type: 'image/png' });
    expect(obscuredNormalized.status).toBe('available');
  });

  it('positive case payloads are byte-identical to their recorded assets', () => {
    const readablePayload = readFileSync(path.join(REPO, READABLE_ASSET)).toString('base64');
    const receipt34044Payload = readFileSync(path.join(REPO, RECEIPT_340_44_ASSET)).toString('base64');
    expect(casePayload('evals/cases/live-behavior-image-multiple-pending-orders.yaml')).toBe(readablePayload);
    // 2026-09-30 live compression: the captionless thread merged into the
    // expired-reference survivor with its image bytes intact.
    // 2026-09-30 condensation: the ambiguous-digits thread merged into the illegible-amount case.
    // 2026-09-30 live compression: the alone-followup thread is turn 1 and
    // the with-text thread is turn 2 of the text-pending survivor.
    expect(casePayload('evals/cases/live-behavior-receipt-text-pending-then-alone.yaml')).toBe(receipt34044Payload);
    expect(casePayload('evals/cases/live-behavior-receipt-text-pending-then-alone.yaml', 2)).toBe(receipt34044Payload);
    expect(casePayload('evals/cases/live-behavior-receipt-gift-only-match.yaml')).toBe(receipt34044Payload);
    // 2026-09-30 live compression: the approved-story thread is turn 2 of
    // the gift-only survivor.
    expect(casePayload('evals/cases/live-behavior-receipt-gift-only-match.yaml', 2)).toBe(receipt34044Payload);
    // 2026-09-30 live compression: the dual-amount thread is turn 0 of the
    // explicit-older-target survivor.
    expect(casePayload('evals/cases/live-behavior-receipt-explicit-older-target.yaml', 0)).toBe(receipt34044Payload);
  });

  it('rejects corrupt and truncated payloads as unavailable', () => {
    // The removed live-behavior-image-file-malformed case carried this exact
    // corrupt payload; it stays covered directly without the case-file hop.
    expect(normalizeInboundImage({ data: '!!!!not-valid-base64!!!!', mime_type: 'image/png' }).status)
      .toBe('unavailable');
    // Historical truncated payloads stay rejected.
    expect(normalizeInboundImage({ data: 'iVBORw0KGgoAAAANSUhEUgAAAZAAAADICAIAAABJdyC1', mime_type: 'image/png' }).status)
      .toBe('unavailable');
    const raw = readFileSync(path.join(REPO, READABLE_ASSET));
    const truncated = raw.subarray(0, raw.length - 64);
    const result = normalizeInboundImage({ data: truncated.toString('base64'), mime_type: 'image/png' });
    expect(result.status).toBe('unavailable');
  });
});
