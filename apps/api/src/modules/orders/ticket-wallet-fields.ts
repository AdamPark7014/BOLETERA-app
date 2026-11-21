export function resolveTicketGate(
  section: string | null | undefined,
  offerZone: string | null | undefined,
  accessZones: { name: string; slug: string }[]
): string | null {
  if (!accessZones?.length) return null;

  const sectionKey = section?.trim().toLowerCase() || null;
  const zoneKey = offerZone?.trim().toLowerCase() || null;

  for (const zone of accessZones) {
    const slug = zone.slug.toLowerCase();
    const name = zone.name.toLowerCase();
    if (zoneKey && slug === zoneKey) return zone.name;
    if (sectionKey && (name === sectionKey || slug === sectionKey)) return zone.name;
  }

  return null;
}

export function walletTicketFields(
  t: { buyerName?: string | null; section?: string | null },
  offerZone: string | null | undefined,
  accessZones: { name: string; slug: string }[]
): { holderName: string | null; gate: string | null } {
  const name = t.buyerName?.trim();
  return {
    holderName: name ? name : null,
    gate: resolveTicketGate(t.section, offerZone, accessZones),
  };
}
