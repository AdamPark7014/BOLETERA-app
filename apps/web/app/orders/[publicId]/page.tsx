import { ORDER_TOKEN_PARAM } from '@/lib/order-access';
import { OrderDetailClient } from './OrderDetailClient';

/**
 * Cáscara de servidor.
 *
 * Antes esta página leía la orden en el servidor, cuando `publicId` bastaba
 * como credencial. Ahora `GET /orders/:publicId` exige `accessToken` o JWT, y
 * ninguno de los dos existe en el servidor: el token llega en el enlace del
 * correo o está archivado en `localStorage`, y la sesión también vive en el
 * navegador. Así que aquí solo se extrae el parámetro de la URL y el resto se
 * resuelve en cliente, con una sola ruta de autenticación en vez de dos.
 */
export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ publicId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { publicId } = await params;
  const query = await searchParams;
  const raw = query[ORDER_TOKEN_PARAM];
  const urlToken = Array.isArray(raw) ? raw[0] : raw;

  return <OrderDetailClient publicId={publicId} urlToken={urlToken} />;
}
