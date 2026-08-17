/** Tipos del centro de mando de accesos. */

export type ScanVerdict = 'approved' | 'rejected' | 'queued';

export type ScanSource = 'camera' | 'manual' | 'queue';

export type ScanTicketInfo = {
  code: string;
  eventTitle: string;
  section?: string | null;
  row?: string | null;
  seatNumber?: string | null;
};

/** Respuesta de POST /access/scan. */
export type ScanApiResponse = {
  success: boolean;
  ticket?: ScanTicketInfo;
};

/** Entrada del historial local de la estación (persistido en localStorage). */
export type ScanRecord = {
  id: string;
  raw: string;
  verdict: ScanVerdict;
  /** ISO-8601 */
  at: string;
  source: ScanSource;
  station: string;
  ticket?: ScanTicketInfo;
  reason?: string;
  latencyMs?: number;
};

/** Escaneo pendiente de sincronizar mientras la estación está offline. */
export type QueuedScan = {
  id: string;
  raw: string;
  /** ISO-8601 */
  at: string;
  station: string;
  source: ScanSource;
};

export type ScanStats = {
  total: number;
  approved: number;
  rejected: number;
  queued: number;
  /** 0–1; null cuando aún no hay escaneos resueltos. */
  approvalRate: number | null;
  /** Escaneos por minuto en la ventana reciente. */
  throughputPerMin: number;
  /** Mejor minuto de la sesión. */
  peakPerMin: number;
  /** Latencia mediana de validación en ms; null si no hay muestras. */
  medianLatencyMs: number | null;
  lastHourCount: number;
};

/** Ventana temporal de las métricas del tablero. */
export type RangeKey = 'today' | 'h24' | 'd7';

export type IncidentTone = 'critical' | 'warning' | 'info';

/** Incidente unificado: rechazo local o alerta de la plataforma. */
export type Incident = {
  id: string;
  tone: IncidentTone;
  title: string;
  detail: string;
  at: string;
  origin: 'station' | 'platform';
};
