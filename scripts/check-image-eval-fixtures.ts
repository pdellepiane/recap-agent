/**
 * F1 image-eval fixture integrity check.
 *
 * Verifies that the image payloads embedded in live-behavior case YAMLs are
 * byte-identical to the synthetic PNG assets under evals/fixtures/images/,
 * and that every payload satisfies the production inbound-image decoder
 * predicates (valid base64, PNG magic, IEND trailer, byte limit).
 *
 * The inbound case schema is unchanged: YAMLs keep image.data/mime_type.
 * This script is the firewall between assets and cases. Run:
 *   npx tsx scripts/check-image-eval-fixtures.ts
 * Exit code is non-zero on any mismatch.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import YAML from 'yaml';

import { MAX_IMAGE_BYTES, normalizeInboundImage } from '../src/core/inbound-image';

const REPO_ROOT = path.join(__dirname, '..');

type ImageCaseExpectation = {
  caseFile: string;
  asset: string;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
};

const IMAGE_CASES: ImageCaseExpectation[] = [
  {
    caseFile: 'evals/cases/live-behavior-image-multiple-pending-orders.yaml',
    asset: 'evals/fixtures/images/receipt-readable-149-90.png',
    width: 800,
    height: 1000,
    bytes: 40976,
    sha256: '15d3842a7e05e4538d15fb095891b5b3a2b4eea23915b49b42c49f62bb71001e',
  },
  {
    caseFile: 'evals/cases/live-behavior-image-readable-captionless.yaml',
    asset: 'evals/fixtures/images/receipt-readable-149-90.png',
    width: 800,
    height: 1000,
    bytes: 40976,
    sha256: '15d3842a7e05e4538d15fb095891b5b3a2b4eea23915b49b42c49f62bb71001e',
  },
  {
    caseFile: 'evals/cases/live-behavior-image-receipt-illegible-amount.yaml',
    asset: 'evals/fixtures/images/receipt-amount-obscured.png',
    width: 800,
    height: 1000,
    bytes: 34099,
    sha256: 'b9070acd5d258ca1e3361ac05638b8de3e3db16f63fdc0b6538a2e335c2f630c',
  },
  {
    caseFile: 'evals/cases/live-behavior-image-receipt-ambiguous-digits.yaml',
    asset: 'evals/fixtures/images/receipt-amount-obscured.png',
    width: 800,
    height: 1000,
    bytes: 34099,
    sha256: 'b9070acd5d258ca1e3361ac05638b8de3e3db16f63fdc0b6538a2e335c2f630c',
  },
  {
    caseFile: 'evals/cases/live-behavior-receipt-text-pending-then-alone.yaml',
    asset: 'evals/fixtures/images/receipt-readable-340-44.png',
    width: 800,
    height: 1000,
    bytes: 45359,
    sha256: '672a8bd61eb295dfc0e938ba2d01d48a9d464cfdedaa1f410a5885609227c26f',
  },
  {
    caseFile: 'evals/cases/live-behavior-receipt-with-text-together.yaml',
    asset: 'evals/fixtures/images/receipt-readable-340-44.png',
    width: 800,
    height: 1000,
    bytes: 45359,
    sha256: '672a8bd61eb295dfc0e938ba2d01d48a9d464cfdedaa1f410a5885609227c26f',
  },
  {
    caseFile: 'evals/cases/live-behavior-receipt-alone-then-followup.yaml',
    asset: 'evals/fixtures/images/receipt-readable-340-44.png',
    width: 800,
    height: 1000,
    bytes: 45359,
    sha256: '672a8bd61eb295dfc0e938ba2d01d48a9d464cfdedaa1f410a5885609227c26f',
  },
  {
    caseFile: 'evals/cases/live-behavior-receipt-gift-only-match.yaml',
    asset: 'evals/fixtures/images/receipt-readable-340-44.png',
    width: 800,
    height: 1000,
    bytes: 45359,
    sha256: '672a8bd61eb295dfc0e938ba2d01d48a9d464cfdedaa1f410a5885609227c26f',
  },
  {
    caseFile: 'evals/cases/live-behavior-receipt-dual-same-amount.yaml',
    asset: 'evals/fixtures/images/receipt-readable-340-44.png',
    width: 800,
    height: 1000,
    bytes: 45359,
    sha256: '672a8bd61eb295dfc0e938ba2d01d48a9d464cfdedaa1f410a5885609227c26f',
  },
  {
    caseFile: 'evals/cases/live-behavior-receipt-explicit-older-target.yaml',
    asset: 'evals/fixtures/images/receipt-readable-340-44.png',
    width: 800,
    height: 1000,
    bytes: 45359,
    sha256: '672a8bd61eb295dfc0e938ba2d01d48a9d464cfdedaa1f410a5885609227c26f',
  },
  {
    caseFile: 'evals/cases/live-behavior-receipt-approved-state.yaml',
    asset: 'evals/fixtures/images/receipt-readable-340-44.png',
    width: 800,
    height: 1000,
    bytes: 45359,
    sha256: '672a8bd61eb295dfc0e938ba2d01d48a9d464cfdedaa1f410a5885609227c26f',
  },
];

const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function readPngDimensions(raw: Buffer): { width: number; height: number } {
  if (!raw.subarray(0, 8).equals(PNG_MAGIC)) {
    throw new Error('Not a PNG file.');
  }
  const width = raw.readUInt32BE(16);
  const height = raw.readUInt32BE(20);
  return { width, height };
}

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function checkAsset(expectation: ImageCaseExpectation): Buffer {
  const assetPath = path.join(REPO_ROOT, expectation.asset);
  let raw: Buffer;
  try {
    raw = readFileSync(assetPath);
  } catch {
    fail(`missing asset ${expectation.asset}`);
  }
  const dims = readPngDimensions(raw);
  if (dims.width !== expectation.width || dims.height !== expectation.height) {
    fail(`${expectation.asset} dimensions ${dims.width}x${dims.height}, expected ${expectation.width}x${expectation.height}.`);
  }
  if (raw.length !== expectation.bytes) {
    fail(`${expectation.asset} is ${raw.length} bytes, expected ${expectation.bytes}.`);
  }
  const hash = createHash('sha256').update(raw).digest('hex');
  if (hash !== expectation.sha256) {
    fail(`${expectation.asset} sha256 ${hash}, expected ${expectation.sha256}.`);
  }
  if (raw.length > MAX_IMAGE_BYTES) {
    fail(`${expectation.asset} exceeds the ${MAX_IMAGE_BYTES}-byte inbound limit.`);
  }
  if (raw.subarray(-8, -4).toString('ascii') !== 'IEND') {
    fail(`${expectation.asset} lacks the PNG IEND trailer.`);
  }
  return raw;
}

function collectBase64Payloads(casePath: string): string[] {
  const doc = YAML.parse(readFileSync(path.join(REPO_ROOT, casePath), 'utf8')) as {
    inputs?: Array<{ image?: { data?: unknown; mime_type?: unknown } }>;
  };
  const payloads: string[] = [];
  for (const input of doc.inputs ?? []) {
    if (input.image && typeof input.image === 'object' && 'data' in input.image) {
      if (typeof input.image.data !== 'string') {
        fail(`${casePath} has a non-string image.data payload.`);
      }
      payloads.push(input.image.data);
    }
  }
  return payloads;
}

let checked = 0;
for (const expectation of IMAGE_CASES) {
  const assetBytes = checkAsset(expectation);
  const expectedPayload = assetBytes.toString('base64');
  const payloads = collectBase64Payloads(expectation.caseFile);
  if (payloads.length === 0) {
    fail(`${expectation.caseFile} has no image.data payload.`);
  }
  for (const payload of payloads) {
    if (payload !== expectedPayload) {
      fail(`${expectation.caseFile} payload differs from ${expectation.asset} (yaml ${payload.length} chars, asset ${expectedPayload.length} chars).`);
    }
    const normalized = normalizeInboundImage({ data: payload, mime_type: 'image/png' });
    if (normalized.status !== 'available') {
      fail(`${expectation.caseFile} payload normalizes as ${normalized.status}.`);
    }
    if (normalized.byteLength !== expectation.bytes) {
      fail(`${expectation.caseFile} payload decodes to ${normalized.byteLength} bytes, expected ${expectation.bytes}.`);
    }
  }
  console.log(`ok: ${expectation.caseFile} matches ${expectation.asset} (${payloads.length} payload turn(s), ${expectation.bytes} bytes).`);
  checked += 1;
}

// The malformed case must stay malformed: its payload must NOT normalize.
const malformedDoc = YAML.parse(
  readFileSync(path.join(REPO_ROOT, 'evals/cases/live-behavior-image-file-malformed.yaml'), 'utf8'),
) as { inputs?: Array<{ image?: { data?: unknown; mime_type?: unknown } }> };
const malformedPayload = malformedDoc.inputs?.[0]?.image;
if (!malformedPayload || typeof malformedPayload !== 'object' || !('data' in malformedPayload)) {
  fail('live-behavior-image-file-malformed.yaml lost its malformed payload shape.');
}
const malformedData = (malformedPayload as { data: unknown }).data;
if (typeof malformedData !== 'string') {
  fail('live-behavior-image-file-malformed.yaml payload is not a string.');
}
const malformedResult = normalizeInboundImage({ data: malformedData, mime_type: 'image/png' });
if (malformedResult.status === 'available') {
  fail('live-behavior-image-file-malformed.yaml payload unexpectedly normalizes as available.');
}
console.log(`ok: live-behavior-image-file-malformed.yaml stays malformed (${malformedResult.status}).`);

console.log(`image fixture integrity: ${checked} asset-backed cases verified.`);
