'use client';

import { useEffect, useRef, useState } from 'react';
import { TicketButton } from '@boletera/ui';
import styles from './scanner.module.scss';

type Props = {
  onScan: (text: string) => void;
  disabled?: boolean;
};

export function CameraScanner({ onScan, disabled }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!active || disabled) return;
    let stream: MediaStream | null = null;
    let raf = 0;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        const Detector = (window as unknown as { BarcodeDetector?: new () => { detect: (src: ImageBitmapSource) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
        if (Detector && videoRef.current) {
          const detector = new Detector();
          const tick = async () => {
            if (!videoRef.current || videoRef.current.readyState < 2) {
              raf = requestAnimationFrame(tick);
              return;
            }
            try {
              const codes = await detector.detect(videoRef.current);
              if (codes[0]?.rawValue) {
                onScan(codes[0].rawValue);
                setActive(false);
                return;
              }
            } catch {
              /* ignore frame errors */
            }
            raf = requestAnimationFrame(tick);
          };
          raf = requestAnimationFrame(tick);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudo acceder a la cámara');
        setActive(false);
      }
    }

    void start();
    return () => {
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [active, disabled, onScan]);

  return (
    <div className={styles.camera}>
      <TicketButton
        variant="secondary"
        onClick={() => setActive((current) => !current)}
        disabled={disabled}
      >
        {active ? 'Detener cámara' : 'Escanear con cámara'}
      </TicketButton>
      {error ? <p className={styles.cameraNote}>{error}</p> : null}
      {active ? <video ref={videoRef} className={styles.video} playsInline muted /> : null}
      {active && !(window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector ? (
        <p className={styles.hint}>Este navegador no lee códigos con la cámara. Pega el código.</p>
      ) : null}
    </div>
  );
}
