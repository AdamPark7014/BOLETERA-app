/**
 * Devuelve la IP del cliente respetando las cabeceras de confianza de Express (como X-Forwarded-For).
 * Si req.ip está definido, lo retorna, de lo contrario devuelve una cadena vacía.
 */
export function clientIp(req: { ip?: string }): string {
  return req.ip ?? '';
}