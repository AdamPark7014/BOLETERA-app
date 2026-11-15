// Color por zona de la maqueta (Evento.dc.html): bronce oscuro para lo más
// barato hasta dorado claro para lo más caro. Si todas las zonas cuestan lo
// mismo, se reparte la rampa por zona para que cada una se distinga.

const RAMP = ['#4A3F33', '#5C4E3E', '#8A7359', '#A68A6B', '#C2A57F', '#D9C2A3'];

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rampAt(t: number): string {
  const x = Math.max(0, Math.min(1, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  const f = x - i;
  const a = hexToRgb(RAMP[i]);
  const b = hexToRgb(RAMP[i + 1]);
  const mix = a.map((v, k) => Math.round(v + (b[k] - v) * f));
  return `#${mix.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

type PricedOffer = { id: string; basePrice: string | number; allInPrice?: number };

/** Mapa id de oferta → color. Estable para el mismo listado de ofertas. */
export function offerTones(offers: readonly PricedOffer[]): Map<string, string> {
  const priced = offers.map((o, index) => ({
    id: o.id,
    index,
    price: Number(o.allInPrice ?? o.basePrice) || 0,
  }));
  const prices = priced.map((o) => o.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const tones = new Map<string, string>();
  if (!priced.length) return tones;
  if (max > min) {
    for (const o of priced) tones.set(o.id, rampAt((o.price - min) / (max - min)));
    return tones;
  }
  const n = priced.length;
  for (const o of priced) tones.set(o.id, rampAt(n === 1 ? 0.6 : o.index / (n - 1)));
  return tones;
}
