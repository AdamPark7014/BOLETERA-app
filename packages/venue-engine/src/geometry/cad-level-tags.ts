/**
 * Encode/decode level tags for CAD round-trip (SVG data-* and DXF layer suffixes).
 */

export type CadLevelTags = {
  levelId?: string;
  fromLevelId?: string;
  toLevelId?: string;
};

/** Sanitize ids for DXF layer names (A-Z0-9_). */
export function sanitizeLevelToken(id: string): string {
  return (
    id
      .toUpperCase()
      .replace(/[^A-Z0-9_]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 20) || 'LVL'
  );
}

/**
 * Append level tags to a DXF base layer.
 * Examples: AISLE__L_PLAZA, STAIRS__F_BALC__T_PLAZA, EXIT__L_PLAZA
 */
export function encodeDxfLayer(base: string, tags?: CadLevelTags): string {
  const b = base.toUpperCase().replace(/[^A-Z0-9_]+/g, '_');
  if (!tags) return b;
  const parts = [b];
  if (tags.fromLevelId || tags.toLevelId) {
    if (tags.fromLevelId) parts.push(`F_${sanitizeLevelToken(tags.fromLevelId)}`);
    if (tags.toLevelId) parts.push(`T_${sanitizeLevelToken(tags.toLevelId)}`);
  } else if (tags.levelId) {
    parts.push(`L_${sanitizeLevelToken(tags.levelId)}`);
  }
  return parts.join('__').slice(0, 31);
}

/**
 * Parse level tags from a DXF layer name. Returns cleaned base role layer
 * (without level suffixes) for classifyRole.
 */
export function decodeDxfLayer(layer: string): {
  baseLayer: string;
  tags: CadLevelTags;
  /** Map from sanitized token → first seen raw id when provided */
} {
  const raw = layer || '0';
  const tags: CadLevelTags = {};
  const chunks = raw.split('__').filter(Boolean);
  if (chunks.length <= 1) {
    return { baseLayer: raw, tags };
  }

  const baseParts: string[] = [];
  for (const chunk of chunks) {
    const f = /^F_(.+)$/i.exec(chunk);
    if (f) {
      tags.fromLevelId = f[1].toLowerCase().replace(/_/g, '-');
      continue;
    }
    const t = /^T_(.+)$/i.exec(chunk);
    if (t) {
      tags.toLevelId = t[1].toLowerCase().replace(/_/g, '-');
      continue;
    }
    const l = /^L_(.+)$/i.exec(chunk);
    if (l) {
      tags.levelId = l[1].toLowerCase().replace(/_/g, '-');
      continue;
    }
    baseParts.push(chunk);
  }

  return {
    baseLayer: baseParts.join('__') || raw,
    tags,
  };
}

/**
 * Resolve sanitized DXF tokens back to authored level ids when possible.
 */
export function resolveLevelToken(
  token: string | undefined,
  levels: Array<{ id: string }>
): string | undefined {
  if (!token) return undefined;
  const exact = levels.find((l) => l.id === token);
  if (exact) return exact.id;
  const sanitized = sanitizeLevelToken(token);
  const bySan = levels.find((l) => sanitizeLevelToken(l.id) === sanitized);
  if (bySan) return bySan.id;
  // Also match when token was lowercased with dashes
  const soft = levels.find((l) => sanitizeLevelToken(l.id) === sanitizeLevelToken(token));
  return soft?.id ?? token;
}
