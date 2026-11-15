import styles from './StageArt.module.scss';

export interface StageArtProps {
  /** Semilla estable (id o slug del evento): cada evento ve sus propias luces. */
  seed?: string;
  className?: string;
  /** Degradado a negro en la parte baja, para poner texto encima. */
  fade?: boolean;
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number) {
  let s = seed || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const CONFETTI = ['#A68A6B', '#D9C2A3', '#FFFFFF'];

/**
 * Fondo de respaldo cuando un evento no tiene imagen: luces de escenario en
 * dorado sobre negro, haces y confeti, con la silueta del público abajo.
 * Nunca un cuadro gris vacío. Determinista por `seed` (mismo SSR y cliente).
 */
export function StageArt({ seed = 'black-ticket', className, fade = true }: StageArtProps) {
  const next = rng(hash(seed));
  const beams = Array.from({ length: 4 }, (_, i) => {
    const top = 160 + next() * 80;
    const spread = 90 + next() * 140;
    const left = top - spread - next() * 60;
    const fill = i === 2 ? '#FFFFFF' : i === 3 ? '#A68A6B' : '#D9C2A3';
    const opacity = 0.08 + next() * 0.14;
    return { points: `${top},0 ${left},400 ${left + spread},400`, fill, opacity };
  });
  const bits = Array.from({ length: 26 }, () => ({
    x: next() * 400,
    y: next() * 300,
    w: 2 + next() * 4,
    h: 2 + next() * 6,
    r: next() * 90,
    fill: CONFETTI[Math.floor(next() * CONFETTI.length)],
    o: 0.35 + next() * 0.55,
  }));
  let crowd = 'M0,400 L0,330';
  for (let x = 0; x <= 400; x += 14) {
    const head = 300 + next() * 30;
    crowd += ` Q${x + 7},${head} ${x + 14},${320 + next() * 14}`;
  }
  crowd += ' L400,400 Z';
  const gid = `bt-stage-${hash(seed).toString(36)}`;

  return (
    <div className={[styles.stage, className].filter(Boolean).join(' ')} aria-hidden="true">
      <svg viewBox="0 0 400 400" preserveAspectRatio="xMidYMid slice" className={styles.svg}>
        <defs>
          <radialGradient id={`${gid}-glow`} cx="50%" cy="0%" r="90%">
            <stop offset="0" stopColor="#A68A6B" stopOpacity="0.75" />
            <stop offset="0.55" stopColor="#A68A6B" stopOpacity="0.12" />
            <stop offset="1" stopColor="#000000" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="400" height="400" fill={`url(#${gid}-glow)`} />
        {beams.map((b, i) => (
          <polygon key={i} points={b.points} fill={b.fill} opacity={b.opacity} />
        ))}
        {bits.map((b, i) => (
          <rect
            key={i}
            x={b.x}
            y={b.y}
            width={b.w}
            height={b.h}
            fill={b.fill}
            opacity={b.o}
            transform={`rotate(${b.r} ${b.x} ${b.y})`}
          />
        ))}
        <path d={crowd} fill="#000000" />
      </svg>
      {fade ? <div className={styles.fade} /> : null}
    </div>
  );
}
