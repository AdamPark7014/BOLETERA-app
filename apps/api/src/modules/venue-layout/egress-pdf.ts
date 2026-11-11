import PDFDocument from 'pdfkit';
import type { EgressReport } from '@boletera/venue-engine';

function fmt(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

/**
 * Build a one-page (or short) A4 PDF summary of an egress report.
 */
export function buildEgressPdfBuffer(report: EgressReport): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));

  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const { summary, policy, analysis, venueName, generatedAt } = report;

  doc.fontSize(18).fillColor('#111').text('BOLETERA — Reporte de egress', { align: 'left' });
  doc.moveDown(0.3);
  doc.fontSize(11).fillColor('#444').text(venueName);
  doc.fontSize(9).fillColor('#666').text(`Generado: ${generatedAt}`);
  doc.moveDown(0.8);

  doc.fontSize(12).fillColor('#111').text('Resumen');
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor('#222');
  const rows: Array<[string, string]> = [
    ['Red de circulación', summary.hasNetwork ? 'Sí' : 'No'],
    [
      'Semillas egress',
      analysis.seedMode === 'exits'
        ? `${analysis.exitCount} salida(s)`
        : analysis.seedMode === 'stage'
          ? 'Escenario (sin salidas)'
          : 'Red pasillos',
    ],
    ['Secciones analizadas', String(summary.sections)],
    ['Sin acceso', String(summary.unreachable)],
    ['Asientos con salida', String(summary.seatsWithPath)],
    ['Asientos sin salida', String(summary.seatsWithoutPath)],
    ['Ruta máx (u)', fmt(summary.maxPathLength, 0)],
    ['Ruta avg (u)', fmt(summary.avgPathLength, 0)],
    ['Vaciado estimado (min)', fmt(summary.clearanceMinutes)],
    ['Caminata máx (min)', fmt(summary.maxWalkMinutes)],
  ];
  for (const [k, v] of rows) {
    doc.text(`${k}: ${v}`);
  }

  doc.moveDown(0.6);
  doc.fontSize(12).fillColor('#111').text('Umbrales (policy)');
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor('#222');
  doc.text(`Vaciado máx: ${policy.slowClearanceMinutes} min`);
  doc.text(`Ruta larga: ${policy.longPathUnits} u`);
  doc.text(`Utilización bottleneck: ${Math.round(policy.bottleneckUtilization * 100)}%`);
  doc.text(`Carga bottleneck: ${policy.bottleneckSeatLoad} asientos`);

  doc.moveDown(0.6);
  doc.fontSize(12).fillColor('#111').text('Secciones');
  doc.moveDown(0.3);
  doc.fontSize(9).fillColor('#222');
  const secHeader =
    'Sección'.padEnd(22) +
    'Asientos'.padStart(8) +
    'Ruta'.padStart(8) +
    'Walk'.padStart(8) +
    'Cola'.padStart(8) +
    'Clear'.padStart(8);
  doc.font('Courier').text(secHeader);
  doc.font('Courier').text('-'.repeat(62));
  for (const s of analysis.egress.sections.slice(0, 24)) {
    const name = (s.sectionName ?? s.sectionId).slice(0, 20).padEnd(22);
    const line =
      name +
      String(s.seatCount).padStart(8) +
      fmt(s.pathLength, 0).padStart(8) +
      fmt(s.walkMinutes).padStart(8) +
      fmt(s.queueMinutes).padStart(8) +
      fmt(s.clearanceMinutes).padStart(8);
    doc.text(line);
  }
  if (analysis.egress.sections.length > 24) {
    doc.font('Helvetica').fontSize(9).fillColor('#666');
    doc.text(`… +${analysis.egress.sections.length - 24} secciones`);
  }

  doc.moveDown(0.6);
  doc.font('Helvetica').fontSize(12).fillColor('#111').text('Cuellos de botella');
  doc.moveDown(0.3);
  doc.fontSize(9).fillColor('#222');
  if (!analysis.egress.bottlenecks.length) {
    doc.text('Ninguno destacado.');
  } else {
    for (const b of analysis.egress.bottlenecks.slice(0, 8)) {
      doc.text(
        `• ${b.kind} · ancho ${b.width}u · carga ${b.seatLoad}/${b.capacity} (${Math.round(b.utilization * 100)}%) · ~${fmt(b.clearanceMinutes)} min · flow ${fmt(b.flowPerMinute, 0)} p/min`
      );
    }
  }

  if (analysis.unreachableSections.length) {
    doc.moveDown(0.6);
    doc.fontSize(12).fillColor('#111').text('Secciones sin acceso');
    doc.moveDown(0.3);
    doc.fontSize(9).fillColor('#b45309');
    doc.text(analysis.unreachableSections.join(', '));
  }

  doc.moveDown(1);
  doc
    .fontSize(8)
    .fillColor('#888')
    .text(
      'Estimaciones heurísticas (caminata + flujo por ancho). No sustituyen ingeniería de seguridad contra incendios.',
      { align: 'left' }
    );

  doc.end();
  return done;
}

export function egressPdfFilename(venueName: string): string {
  const safe = venueName.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 40) || 'venue';
  const day = new Date().toISOString().slice(0, 10);
  return `egress-${safe}-${day}.pdf`;
}
