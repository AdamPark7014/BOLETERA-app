// Color por zona: tonos neutros y fríos que se distinguen entre sí (el dorado
// queda solo para «Tu selección», que es la acción). Por precio de menor a
// mayor; si todas cuestan lo mismo, uno por zona.

const RAMP = ['#6F7F8F', '#8C9DB0', '#A9B9C9', '#C7D2DC', '#E3E8EC'];
/** Paleta categórica cuando el precio no ordena: contrastes claros entre vecinas. */
const DISTINCT = [
  '#9DB4CC',
  '#B7A6C9',
  '#93BFAE',
  '#D3C3A5',
  '#C9A3A3',
  '#A9B3BD',
  '#C4C9A0',
  '#8FA7B8',
];

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
  for (const o of priced) tones.set(o.id, DISTINCT[o.index % DISTINCT.length]);
  return tones;
}
