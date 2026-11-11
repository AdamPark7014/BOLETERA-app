/**
 * Smoke PDF builder used by the API egress endpoint.
 * Runs from apps/api so pdfkit resolves correctly.
 */
const path = require('path');
const Module = require('module');

// Resolve workspace venue-engine from api cwd
const engine = require(path.resolve(__dirname, '../../../packages/venue-engine/dist/index.js'));

// Load TS-compiled helper via dynamic transpile: inline minimal re-require of source through ts-node if needed.
// Prefer requiring the same logic by spawning after nest build; here we duplicate the call path by
// registering ts-node if available, else eval the built file after tsc of a stub.

async function main() {
  let buildEgressPdfBuffer;
  let egressPdfFilename;
  try {
    // When nest has built: dist/modules/venue-layout/egress-pdf.js
    const built = path.resolve(__dirname, '../dist/modules/venue-layout/egress-pdf.js');
    ({ buildEgressPdfBuffer, egressPdfFilename } = require(built));
  } catch {
    // Dev: register ts-node and load source
    try {
      require('ts-node').register({
        transpileOnly: true,
        compilerOptions: { module: 'commonjs', esModuleInterop: true },
      });
      ({
        buildEgressPdfBuffer,
        egressPdfFilename,
      } = require('../src/modules/venue-layout/egress-pdf.ts'));
    } catch (e) {
      console.error('Cannot load egress-pdf (build api or install ts-node)', e.message);
      process.exit(1);
    }
  }

  const map = engine.generateTheaterTemplate();
  const stage = map.venue.stage;
  const cx = stage.x + stage.width / 2;
  map.venue = {
    ...map.venue,
    scale: 40,
    aisles: [
      {
        id: 'main',
        width: 20,
        points: [
          [cx, stage.y + 30],
          [cx, 380],
        ],
      },
    ],
  };

  const report = engine.buildEgressReport(map, { venueName: 'PDF Venue' });
  const buf = await buildEgressPdfBuffer(report);
  if (!Buffer.isBuffer(buf) || buf.length < 100) throw new Error('empty pdf');
  const head = buf.subarray(0, 5).toString('utf8');
  if (head !== '%PDF-') throw new Error(`bad header ${head}`);
  const name = egressPdfFilename(report.venueName);
  if (!name.endsWith('.pdf')) throw new Error(name);

  console.log('pdf bytes', buf.length, 'file', name);
  console.log('EGRESS_PDF_SMOKE_OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
