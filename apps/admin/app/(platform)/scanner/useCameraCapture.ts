'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/**
 * Captura de cámara + decodificación de códigos.
 *
 * Regla dura: los cuadros de video nunca entran al estado de React. El
 * `MediaStream`, el detector y el último valor leído viven en refs; el hook
 * sólo publica estado escalar (status, dispositivos, linterna).
 */

type DetectedCode = { rawValue: string };

type BarcodeDetectorLike = {
  detect(source: CanvasImageSource): Promise<DetectedCode[]>;
};

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

type BarcodeDetectorGlobal = {
  BarcodeDetector?: BarcodeDetectorCtor & {
    getSupportedFormats?: () => Promise<string[]>;
  };
};

type TorchCapabilities = MediaTrackCapabilities & { torch?: boolean };

export type CameraStatus =
  | 'idle'
  | 'requesting'
  | 'running'
  | 'denied'
  | 'unsupported'
  | 'error';

export type CameraDevice = { deviceId: string; label: string };

export type CameraCapture = {
  videoRef: RefObject<HTMLVideoElement | null>;
  status: CameraStatus;
  error: string;
  active: boolean;
  /** El navegador expone `BarcodeDetector`; si no, sólo hay modo manual. */
  decoderSupported: boolean;
  devices: CameraDevice[];
  deviceId: string | null;
  selectDevice: (deviceId: string) => void;
  torchAvailable: boolean;
  torchOn: boolean;
  toggleTorch: () => void;
  start: () => void;
  stop: () => void;
};

/** Espaciado entre intentos de decodificación (ms). */
const DECODE_INTERVAL_MS = 140;
/** Ventana para ignorar relecturas del mismo código. */
const REPEAT_WINDOW_MS = 3_000;

function detectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as BarcodeDetectorGlobal).BarcodeDetector ?? null;
}

function cameraSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices !== 'undefined' &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  );
}

function messageFor(cause: unknown): { status: CameraStatus; message: string } {
  const name = cause instanceof DOMException ? cause.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return {
      status: 'denied',
      message: 'Permiso de cámara denegado. Habilítalo en el navegador o usa el modo manual.',
    };
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return {
      status: 'error',
      message: 'No se encontró una cámara disponible en este dispositivo.',
    };
  }
  if (name === 'NotReadableError') {
    return {
      status: 'error',
      message: 'La cámara está ocupada por otra aplicación. Ciérrala e intenta de nuevo.',
    };
  }
  return {
    status: 'error',
    message: cause instanceof Error ? cause.message : 'No se pudo iniciar la cámara.',
  };
}

export function useCameraCapture(options: {
  onDecode: (value: string) => void;
  /** Suspende la decodificación sin apagar la cámara (p. ej. validando). */
  paused?: boolean;
}): CameraCapture {
  const { onDecode, paused = false } = options;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const onDecodeRef = useRef(onDecode);
  const pausedRef = useRef(paused);
  const lastValueRef = useRef<{ value: string; at: number } | null>(null);

  const [active, setActive] = useState(false);
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [error, setError] = useState('');
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [decoderSupported, setDecoderSupported] = useState(true);

  onDecodeRef.current = onDecode;
  pausedRef.current = paused;

  useEffect(() => {
    setDecoderSupported(detectorCtor() !== null);
  }, []);

  const refreshDevices = useCallback(async () => {
    if (!cameraSupported() || typeof navigator.mediaDevices.enumerateDevices !== 'function') {
      return;
    }
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(
        all
          .filter((device) => device.kind === 'videoinput')
          .map((device, index) => ({
            deviceId: device.deviceId,
            label: device.label || `Cámara ${index + 1}`,
          }))
          .filter((device) => device.deviceId !== ''),
      );
    } catch {
      /* enumerar dispositivos es opcional */
    }
  }, []);

  const start = useCallback(() => {
    if (!cameraSupported()) {
      setStatus('unsupported');
      setError(
        typeof window !== 'undefined' && !window.isSecureContext
          ? 'La cámara requiere una conexión segura (HTTPS). Usa el modo manual.'
          : 'Este navegador no permite acceder a la cámara. Usa el modo manual.',
      );
      return;
    }
    setError('');
    setActive(true);
  }, []);

  const stop = useCallback(() => {
    setActive(false);
    setTorchOn(false);
  }, []);

  const selectDevice = useCallback((next: string) => {
    setDeviceId(next || null);
  }, []);

  useEffect(() => {
    if (!active) {
      setStatus((current) =>
        current === 'denied' || current === 'error' || current === 'unsupported'
          ? current
          : 'idle',
      );
      return;
    }

    let disposed = false;
    let raf = 0;
    let stream: MediaStream | null = null;
    let decoding = false;
    let lastAttempt = 0;

    const stopStream = () => {
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      streamRef.current = null;
      const video = videoRef.current;
      if (video) video.srcObject = null;
    };

    const handleValue = (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return;
      const now = Date.now();
      const previous = lastValueRef.current;
      if (previous && previous.value === trimmed && now - previous.at < REPEAT_WINDOW_MS) return;
      lastValueRef.current = { value: trimmed, at: now };
      onDecodeRef.current(trimmed);
    };

    const run = async () => {
      setStatus('requesting');
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: deviceId
            ? { deviceId: { exact: deviceId } }
            : { facingMode: { ideal: 'environment' } },
          audio: false,
        });
      } catch (cause) {
        if (disposed) return;
        const mapped = messageFor(cause);
        setStatus(mapped.status);
        setError(mapped.message);
        setActive(false);
        return;
      }

      if (disposed) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      const [track] = stream.getVideoTracks();
      if (track && typeof track.getCapabilities === 'function') {
        const capabilities = track.getCapabilities() as TorchCapabilities;
        setTorchAvailable(capabilities.torch === true);
      } else {
        setTorchAvailable(false);
      }
      if (track && !deviceId) {
        const settingsId = track.getSettings().deviceId;
        if (typeof settingsId === 'string' && settingsId) setDeviceId(settingsId);
      }

      const video = videoRef.current;
      if (!video) {
        stopStream();
        return;
      }
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        /* algunos navegadores rechazan play() hasta un gesto; el <video> autoplay lo resuelve */
      }
      if (disposed) {
        stopStream();
        return;
      }
      setStatus('running');
      void refreshDevices();

      const Detector = detectorCtor();
      if (!Detector) {
        setDecoderSupported(false);
        return;
      }
      setDecoderSupported(true);

      let detector: BarcodeDetectorLike;
      try {
        detector = new Detector({ formats: ['qr_code', 'code_128', 'ean_13'] });
      } catch {
        try {
          detector = new Detector();
        } catch {
          setDecoderSupported(false);
          return;
        }
      }

      const tick = () => {
        if (disposed) return;
        raf = requestAnimationFrame(tick);
        const element = videoRef.current;
        if (!element || element.readyState < 2 || pausedRef.current || decoding) return;
        const now = performance.now();
        if (now - lastAttempt < DECODE_INTERVAL_MS) return;
        lastAttempt = now;
        decoding = true;
        detector
          .detect(element)
          .then((codes) => {
            const first = codes[0];
            if (first) handleValue(first.rawValue);
          })
          .catch(() => {
            /* cuadros inválidos o detector ocupado: se reintenta en el siguiente ciclo */
          })
          .finally(() => {
            decoding = false;
          });
      };

      raf = requestAnimationFrame(tick);
    };

    void run();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      stopStream();
    };
  }, [active, deviceId, refreshDevices]);

  const toggleTorch = useCallback(() => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    setTorchOn((current) => {
      const next = !current;
      void track
        .applyConstraints({ advanced: [{ torch: next }] } as unknown as MediaTrackConstraints)
        .catch(() => setTorchAvailable(false));
      return next;
    });
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') stop();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [stop]);

  return {
    videoRef,
    status,
    error,
    active,
    decoderSupported,
    devices,
    deviceId,
    selectDevice,
    torchAvailable,
    torchOn,
    toggleTorch,
    start,
    stop,
  };
}
