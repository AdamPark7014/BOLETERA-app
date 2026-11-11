import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(__dirname, '../../../apps/web/public/posters');

const posters = [
  {
    slug: 'concierto-demo-2026',
    title: ['CONCIERTO', 'DEMO 2026'],
    sub: 'MUSICA',
    a: '#4c0519',
    b: '#e11d48',
    c: '#0a0a0a',
    motif: 'rings',
  },
  {
    slug: 'noche-indie-cdmx',
    title: ['NOCHE', 'INDIE'],
    sub: 'CDMX',
    a: '#1c1917',
    b: '#a16207',
    c: '#0a0a0a',
    motif: 'bars',
  },
  {
    slug: 'stand-up-gdl',
    title: ['STAND-UP', 'GDL'],
    sub: 'COMEDIA',
    a: '#431407',
    b: '#c2410c',
    c: '#0a0a0a',
    motif: 'mic',
  },
  {
    slug: 'obra-clasica-gdl',
    title: ['OBRA', 'CLASICA'],
    sub: 'TEATRO',
    a: '#1c1917',
    b: '#78716c',
    c: '#0a0a0a',
    motif: 'curtain',
  },
  {
    slug: 'clasico-regio',
    title: ['CLASICO', 'REGIO'],
    sub: 'DEPORTES',
    a: '#0c4a6e',
    b: '#0284c7',
    c: '#0a0a0a',
    motif: 'pitch',
  },
  {
    slug: 'festival-verano-mty',
    title: ['FESTIVAL', 'VERANO'],
    sub: 'MTY',
    a: '#4c0519',
    b: '#be123c',
    c: '#0a0a0a',
    motif: 'burst',
  },
  {
    slug: 'electro-night-cdmx',
    title: ['ELECTRO', 'NIGHT'],
    sub: 'CDMX',
    a: '#18181b',
    b: '#e11d48',
    c: '#0a0a0a',
    motif: 'wave',
  },
  {
    slug: 'ballet-gdl',
    title: ['BALLET', 'GDL'],
    sub: 'ARTES',
    a: '#1c1917',
    b: '#a8a29e',
    c: '#0a0a0a',
    motif: 'arc',
  },
  {
    slug: 'final-regional-mty',
    title: ['FINAL', 'REGIONAL'],
    sub: 'MTY',
    a: '#14532d',
    b: '#22c55e',
    c: '#0a0a0a',
    motif: 'pitch',
  },
  {
    slug: 'comedia-abierta-cdmx',
    title: ['COMEDIA', 'ABIERTA'],
    sub: 'CDMX',
    a: '#7c2d12',
    b: '#fb923c',
    c: '#0a0a0a',
    motif: 'mic',
  },
  {
    slug: 'jazz-al-atardecer',
    title: ['JAZZ AL', 'ATARDECER'],
    sub: 'LIVE',
    a: '#422006',
    b: '#f59e0b',
    c: '#0a0a0a',
    motif: 'wave',
  },
  {
    slug: 'open-air-fest-cdmx',
    title: ['OPEN AIR', 'FEST'],
    sub: 'CDMX',
    a: '#831843',
    b: '#f472b6',
    c: '#0a0a0a',
    motif: 'burst',
  },
];

function motif(kind) {
  if (kind === 'rings') {
    return `
    <circle cx="400" cy="430" r="230" stroke="rgba(255,255,255,0.12)" stroke-width="2" fill="none"/>
    <circle cx="400" cy="430" r="160" stroke="rgba(255,255,255,0.18)" stroke-width="2" fill="none"/>
    <circle cx="400" cy="430" r="80" stroke="#fff" stroke-width="4" fill="none" opacity="0.7"/>`;
  }
  if (kind === 'bars') {
    return `
    <rect x="180" y="280" width="40" height="320" fill="rgba(255,255,255,0.12)"/>
    <rect x="260" y="220" width="40" height="380" fill="rgba(255,255,255,0.18)"/>
    <rect x="340" y="300" width="40" height="300" fill="rgba(255,255,255,0.12)"/>
    <rect x="420" y="180" width="40" height="420" fill="rgba(255,255,255,0.22)"/>
    <rect x="500" y="260" width="40" height="340" fill="rgba(255,255,255,0.14)"/>
    <rect x="580" y="210" width="40" height="390" fill="rgba(255,255,255,0.1)"/>`;
  }
  if (kind === 'mic') {
    return `
    <rect x="375" y="300" width="50" height="160" rx="25" fill="rgba(255,255,255,0.85)"/>
    <path d="M330 460 Q400 520 470 460" stroke="rgba(255,255,255,0.55)" stroke-width="8" fill="none"/>
    <line x1="400" y1="520" x2="400" y2="620" stroke="rgba(255,255,255,0.7)" stroke-width="8"/>
    <line x1="350" y1="620" x2="450" y2="620" stroke="rgba(255,255,255,0.7)" stroke-width="8"/>`;
  }
  if (kind === 'curtain') {
    return `
    <path d="M80 120 Q200 220 80 360 Q200 500 80 640 Q200 780 80 900" stroke="rgba(255,255,255,0.18)" stroke-width="28" fill="none"/>
    <path d="M720 120 Q600 220 720 360 Q600 500 720 640 Q600 780 720 900" stroke="rgba(255,255,255,0.18)" stroke-width="28" fill="none"/>
    <rect x="260" y="300" width="280" height="8" fill="rgba(255,255,255,0.35)"/>
    <rect x="300" y="360" width="200" height="8" fill="rgba(255,255,255,0.2)"/>`;
  }
  if (kind === 'pitch') {
    return `
    <ellipse cx="400" cy="480" rx="260" ry="120" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="3"/>
    <ellipse cx="400" cy="480" rx="170" ry="78" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="2"/>
    <rect x="370" y="250" width="60" height="140" rx="8" fill="#e11d48"/>`;
  }
  if (kind === 'burst') {
    const rays = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330]
      .map((a) => {
        const rad = (a * Math.PI) / 180;
        const x2 = 400 + Math.cos(rad) * 220;
        const y2 = 420 + Math.sin(rad) * 220;
        return `<line x1="400" y1="420" x2="${x2}" y2="${y2}" stroke="rgba(255,255,255,0.25)" stroke-width="3"/>`;
      })
      .join('');
    return `<circle cx="400" cy="420" r="40" fill="rgba(255,255,255,0.9)"/>${rays}`;
  }
  if (kind === 'wave') {
    return `
    <path d="M60 520 Q200 420 340 520 T620 520 T740 520" stroke="rgba(255,255,255,0.35)" stroke-width="4" fill="none"/>
    <path d="M60 580 Q200 480 340 580 T620 580 T740 580" stroke="rgba(255,255,255,0.18)" stroke-width="4" fill="none"/>
    <path d="M60 640 Q200 540 340 640 T620 640 T740 640" stroke="rgba(255,255,255,0.1)" stroke-width="4" fill="none"/>`;
  }
  return `
    <path d="M180 520 Q400 280 620 520" stroke="rgba(255,255,255,0.3)" stroke-width="4" fill="none"/>
    <path d="M220 580 Q400 380 580 580" stroke="rgba(255,255,255,0.15)" stroke-width="4" fill="none"/>`;
}

function posterSvg(p) {
  const text = p.title
    .map(
      (t, i) =>
        `<text x="60" y="${780 + i * 54}" fill="#fff" font-family="Arial Black, Arial, sans-serif" font-size="52" font-weight="900" letter-spacing="2">${t}</text>`
    )
    .join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000" viewBox="0 0 800 1000" fill="none">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${p.a}"/>
      <stop offset="55%" stop-color="${p.b}"/>
      <stop offset="100%" stop-color="${p.c}"/>
    </linearGradient>
  </defs>
  <rect width="800" height="1000" fill="url(#g)"/>
  <circle cx="640" cy="180" r="220" fill="rgba(255,255,255,0.05)"/>
  ${motif(p.motif)}
  <text x="60" y="70" fill="rgba(255,255,255,0.55)" font-family="Arial,sans-serif" font-size="22" letter-spacing="10">BOLETERA</text>
  <text x="60" y="110" fill="rgba(255,255,255,0.85)" font-family="Arial,sans-serif" font-size="18" letter-spacing="6">${p.sub}</text>
  ${text}
</svg>`;
}

fs.mkdirSync(dir, { recursive: true });

for (const p of posters) {
  fs.writeFileSync(path.join(dir, `${p.slug}.svg`), posterSvg(p), 'utf8');
  console.log('wrote', p.slug);
}

const cats = [
  { f: 'music.svg', label: 'MUSICA', a: '#4c0519', b: '#e11d48', motif: 'rings' },
  { f: 'theater.svg', label: 'TEATRO', a: '#1c1917', b: '#a16207', motif: 'curtain' },
  { f: 'sports.svg', label: 'DEPORTES', a: '#0c4a6e', b: '#0284c7', motif: 'pitch' },
  { f: 'festival.svg', label: 'FESTIVAL', a: '#831843', b: '#fb7185', motif: 'burst' },
  { f: 'comedy.svg', label: 'COMEDIA', a: '#431407', b: '#c2410c', motif: 'mic' },
];

for (const c of cats) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000" viewBox="0 0 800 1000" fill="none">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${c.a}"/>
      <stop offset="60%" stop-color="${c.b}"/>
      <stop offset="100%" stop-color="#0a0a0a"/>
    </linearGradient>
  </defs>
  <rect width="800" height="1000" fill="url(#g)"/>
  ${motif(c.motif)}
  <text x="60" y="70" fill="rgba(255,255,255,0.55)" font-family="Arial,sans-serif" font-size="22" letter-spacing="10">BOLETERA</text>
  <text x="60" y="920" fill="#fff" font-family="Arial Black, Arial, sans-serif" font-size="48" letter-spacing="4">${c.label}</text>
</svg>`;
  fs.writeFileSync(path.join(dir, c.f), svg, 'utf8');
}

console.log('done', dir);
