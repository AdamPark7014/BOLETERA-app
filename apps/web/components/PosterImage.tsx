'use client';

import { useEffect, useRef, useState, type ImgHTMLAttributes } from 'react';

type PosterImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'> & {
  src: string;
  /** Imagen local que entra si `src` no carga (URL muerta, red caída). */
  fallbackSrc: string;
};

/**
 * Póster con respaldo. Si la foto remota falla se cambia una sola vez a la local.
 * El error puede ocurrir antes de hidratar: por eso también se revisa al montar
 * si la imagen ya terminó sin pixeles.
 */
export function PosterImage({ src, fallbackSrc, alt = '', ...rest }: PosterImageProps) {
  const [current, setCurrent] = useState(src);
  const ref = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setCurrent(src);
  }, [src]);

  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0 && current !== fallbackSrc) {
      setCurrent(fallbackSrc);
    }
  }, [current, fallbackSrc]);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      src={current}
      alt={alt}
      onError={() => {
        if (current !== fallbackSrc) setCurrent(fallbackSrc);
      }}
      {...rest}
    />
  );
}
