import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { RenderedEmail } from './email-layout';

/**
 * Se lanza cuando hay que mandar un correo y no hay SMTP configurado.
 *
 * En desarrollo esto se registra y ya está. En producción se lanza a propósito:
 * el job de Bull falla, se reintenta y —si sigue sin haber SMTP— queda en la
 * cola de fallidos, donde `getQueueStats()` lo enseña. Antes esto devolvía
 * `{ sent: false }` en silencio: la plataforma daba por entregado un correo que
 * nunca salió, y nadie se enteraba hasta que el comprador reclamaba en la puerta.
 */
export class MailTransportNotConfiguredError extends Error {
  constructor(to: string, subject: string) {
    super(
      `SMTP no está configurado (falta SMTP_HOST) y hay que entregar "${subject}" a ${to}. ` +
        `Configura SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASSWORD.`,
    );
    this.name = 'MailTransportNotConfiguredError';
  }
}

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST');
    if (host) {
      const port = Number(this.config.get('SMTP_PORT') ?? 587);
      this.transporter = nodemailer.createTransport({
        host,
        port,
        // 465 es SMTPS (TLS desde el saludo); 587 y 25 negocian STARTTLS.
        secure: port === 465,
        auth: this.config.get('SMTP_USER')
          ? { user: this.config.get('SMTP_USER'), pass: this.config.get('SMTP_PASSWORD') }
          : undefined,
        // Un onsale genera ráfagas de cientos de correos: reutilizar la conexión
        // evita un saludo TLS por mensaje y que el proveedor nos limite.
        pool: true,
        maxConnections: Number(this.config.get('SMTP_MAX_CONNECTIONS') ?? 5),
        maxMessages: 100,
      });
    }
  }

  /**
   * Comprobación al arranque: es la diferencia entre enterarse de que las
   * credenciales SMTP están mal ahora o cuando el primer comprador reclame.
   * No tumba el proceso — la API debe poder vender aunque el correo falle.
   */
  onModuleInit() {
    if (!this.transporter) {
      const message =
        'SMTP_HOST no está configurado: los correos NO se envían, solo se registran en el log. ' +
        'Confirmaciones de compra, boletos en PDF y avisos de pago no llegarán a los compradores.';
      if (this.isProduction()) this.logger.error(message);
      else this.logger.warn(message);
      return;
    }
    // Sin `await`: un SMTP inalcanzable tarda hasta 30 s en dar el timeout y
    // eso retrasaría el arranque de TODA la API. La comprobación es
    // informativa, no una precondición para vender.
    this.transporter
      .verify()
      .then(() => this.logger.log(`SMTP listo (${this.config.get('SMTP_HOST')})`))
      .catch((error: unknown) =>
        this.logger.error(
          `SMTP configurado pero inalcanzable: ${error instanceof Error ? error.message : String(error)}. ` +
            `Los correos fallarán y quedarán en la cola de fallidos.`,
        ),
      );
  }

  /** ¿Hay transporte real? Lo usa el procesador para decidir cómo registrar. */
  isConfigured(): boolean {
    return this.transporter !== null;
  }

  private isProduction(): boolean {
    return (this.config.get<string>('NODE_ENV') ?? process.env.NODE_ENV) === 'production';
  }

  private from() {
    return this.config.get('MAIL_FROM') ?? 'noreply@boletera.com';
  }

  /**
   * Envoltura mínima para fragmentos HTML sueltos (compatibilidad).
   *
   * Los correos nuevos llegan ya maquetados desde `email-layout.ts`; esto solo
   * cubre las llamadas que pasan un trozo de HTML sin documento.
   */
  wrapHtml(body: string, title: string) {
    return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${title}</title></head>
<body style="margin:0;padding:24px;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%;max-width:600px;background:#fff;border:1px solid #e4e4e7;border-radius:12px">
<tr><td style="padding:24px">
<p style="font-weight:800;font-size:18px;letter-spacing:.14em;margin:0 0 16px;color:#18181b">BOLETERA</p>
${body}
<p style="color:#71717a;font-size:12px;margin-top:24px">Este correo es transaccional.</p>
</td></tr></table>
</td></tr></table>
</body></html>`;
  }

  /** Atajo para los documentos generados por `renderEmailDocument`. */
  async sendDocument(
    to: string,
    doc: RenderedEmail,
    attachments?: { filename: string; content: Buffer; contentType?: string }[],
  ) {
    return this.send({ to, subject: doc.subject, html: doc.html, text: doc.text, attachments, wrap: false });
  }

  async send(opts: {
    to: string;
    subject: string;
    html: string;
    /** Versión de solo texto. Si falta, se deriva del HTML como último recurso. */
    text?: string;
    attachments?: { filename: string; content: Buffer; contentType?: string }[];
    wrap?: boolean;
  }) {
    // Un documento completo no se vuelve a envolver aunque no se pase `wrap`.
    const isFullDocument = /^\s*<(!doctype|html)/i.test(opts.html);
    const html = opts.wrap === false || isFullDocument ? opts.html : this.wrapHtml(opts.html, opts.subject);
    const text = opts.text ?? htmlToText(html);

    if (!this.transporter) {
      // Sin transporte no hay entrega. Se deja rastro completo (destinatario,
      // asunto y cuerpo en texto) para poder depurar en local, y en producción
      // se convierte en fallo visible del job.
      this.logger.warn(
        `[MAIL SIN SMTP] No enviado → ${opts.to} · "${opts.subject}"\n${text.slice(0, 1200)}`,
      );
      if (this.isProduction()) throw new MailTransportNotConfiguredError(opts.to, opts.subject);
      return { sent: false, dev: true };
    }

    try {
      const info = await this.transporter.sendMail({
        from: this.from(),
        to: opts.to,
        replyTo: this.config.get('MAIL_REPLY_TO') ?? undefined,
        subject: opts.subject,
        html,
        text,
        attachments: opts.attachments,
      });
      this.logger.log(`Correo enviado → ${opts.to} · "${opts.subject}" (${info.messageId})`);
      return { sent: true, messageId: info.messageId };
    } catch (error) {
      // Se registra con contexto y se relanza: quien decide si reintentar es la
      // cola, no este servicio. Tragar el error aquí es perder el aviso.
      this.logger.error(
        `Fallo SMTP al enviar "${opts.subject}" a ${opts.to}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }
}

/** Degradado a texto plano cuando quien llama no trae su propia versión. */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h1|h2|h3|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
