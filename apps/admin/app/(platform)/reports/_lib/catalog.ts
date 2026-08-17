import type { ReportCatalogItem } from './types';

/** Catálogo vivo de reportes disponibles en el centro. */
export const REPORT_CATALOG: readonly ReportCatalogItem[] = [
  {
    id: 'executive',
    title: 'Resumen ejecutivo',
    description: 'Ingresos, boletos y conversión del periodo seleccionado.',
    href: '#executive',
    tone: 'accent',
    live: true,
  },
  {
    id: 'channels',
    title: 'Ventas por canal',
    description: 'Desglose de órdenes y monto por canal de venta.',
    href: '#channels',
    tone: 'info',
    live: true,
  },
  {
    id: 'attendance',
    title: 'Asistencia y acceso',
    description: 'Check-ins, no-shows y tráfico por punto de acceso.',
    href: '#attendance',
    tone: 'success',
    live: true,
  },
  {
    id: 'pace',
    title: 'Ritmo de ventas',
    description: 'Eventos con ritmo bajo o en riesgo de aforo.',
    href: '#pace',
    tone: 'warning',
    live: true,
  },
  {
    id: 'settlement',
    title: 'Liquidación',
    description: 'Bruto, comisión y neto a promotores por periodo.',
    href: '#settlement',
    tone: 'neutral',
    live: true,
  },
  {
    id: 'z-reports',
    title: 'Z-reports taquilla',
    description: 'Cortes de caja archivados por terminal y cajero.',
    href: '#z-reports',
    tone: 'neutral',
    live: true,
  },
  {
    id: 'egress',
    title: 'Egress y cumplimiento',
    description: 'Salud de circulación y vaciado por venue.',
    href: '/reports/egress',
    tone: 'danger',
    live: true,
  },
] as const;
