import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

/**
 * Errores de Prisma que significan «la base está saturada», no «la petición está
 * mal»: pool agotado (P2024), no se pudo abrir la transacción a tiempo (P2028) y
 * conflicto de escritura/interbloqueo (P2034). En la prueba de carga con 5,000
 * compradores salían como 500 genérico; con 503 + Retry-After el cliente sabe
 * que puede reintentar y la sala de espera puede frenar la entrada.
 */
const SATURATION_CODES = new Set(['P2024', 'P2028', 'P2034']);
const RETRY_AFTER_SECONDS = 2;

function isSaturation(exception: unknown): boolean {
  const code = (exception as { code?: unknown } | null)?.code;
  return typeof code === 'string' && SATURATION_CODES.has(code);
}

/**
 * Catches everything Nest's default handler would otherwise leak straight to
 * the client (stack traces, Prisma error internals, etc.) and returns a
 * consistent { statusCode, message } shape instead. Known HttpExceptions
 * keep their own status/message; anything else becomes a generic 500 with
 * the real error logged server-side only.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      response.status(status).json(exception.getResponse());
      return;
    }

    if (isSaturation(exception)) {
      this.logger.warn(
        `Base saturada (${(exception as { code: string }).code}): se responde 503 con Retry-After`
      );
      response
        .status(HttpStatus.SERVICE_UNAVAILABLE)
        .setHeader('Retry-After', String(RETRY_AFTER_SECONDS))
        .json({
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          message: 'Hay mucha demanda en este momento. Intenta de nuevo en unos segundos.',
        });
      return;
    }

    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    });
  }
}
