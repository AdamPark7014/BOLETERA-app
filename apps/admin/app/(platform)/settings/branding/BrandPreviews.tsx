'use client';

import { Badge } from '@boletera/ui';
import {
  STOREFRONT_FONT,
  TICKET_DISPLAY_FONT,
  type DerivedPalette,
} from './branding-utils';
import styles from './branding.module.scss';

export type PreviewSurface = 'storefront' | 'ticket' | 'email';

type BrandPreviewsProps = {
  surface: PreviewSurface;
  palette: DerivedPalette;
  subdomain: string;
  logoUrl: string;
  logoBroken: boolean;
  onLogoError: () => void;
  customDomain?: string | null;
};

function BrandMark({
  subdomain,
  logoUrl,
  logoBroken,
  onLogoError,
  className,
}: {
  subdomain: string;
  logoUrl: string;
  logoBroken: boolean;
  onLogoError: () => void;
  className?: string;
}) {
  if (logoUrl && !logoBroken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- remote / data URL from organizer
      <img className={className} src={logoUrl} alt="" onError={onLogoError} />
    );
  }
  return (
    <span className={styles.logoFallback} aria-hidden="true">
      {(subdomain || 'B').slice(0, 1).toUpperCase()}
    </span>
  );
}

export function BrandPreviews({
  surface,
  palette,
  subdomain,
  logoUrl,
  logoBroken,
  onLogoError,
  customDomain,
}: BrandPreviewsProps) {
  const host = customDomain?.trim() || `${(subdomain || 'demo').toLowerCase()}.boletera.app`;
  const brandName = subdomain || 'tu-marca';

  if (surface === 'ticket') {
    return (
      <div
        className={styles.ticketShell}
        style={{ fontFamily: TICKET_DISPLAY_FONT, borderColor: palette.primary }}
        aria-label="Vista previa del boleto"
      >
        <div className={styles.ticketAccent} style={{ background: palette.primary }} />
        <div className={styles.ticketBody}>
          <div className={styles.ticketTop}>
            <BrandMark
              subdomain={subdomain}
              logoUrl={logoUrl}
              logoBroken={logoBroken}
              onLogoError={onLogoError}
              className={styles.ticketLogo}
            />
            <div>
              <p className={styles.ticketOrg}>{brandName}</p>
              <p className={styles.ticketHost}>{host}</p>
            </div>
          </div>
          <h3 className={styles.ticketEvent}>Evento de ejemplo</h3>
          <dl className={styles.ticketMeta}>
            <div>
              <dt>Zona</dt>
              <dd>Platea A</dd>
            </div>
            <div>
              <dt>Asiento</dt>
              <dd>F · 12</dd>
            </div>
            <div>
              <dt>Orden</dt>
              <dd>TKT-10482</dd>
            </div>
          </dl>
          <div className={styles.ticketFooter}>
            <span
              className={styles.ticketChip}
              style={{ background: palette.accentSoft, color: palette.primary }}
            >
              Acceso general
            </span>
            <span className={styles.ticketQr} aria-hidden="true" />
          </div>
        </div>
      </div>
    );
  }

  if (surface === 'email') {
    return (
      <div
        className={styles.emailShell}
        style={{ fontFamily: STOREFRONT_FONT }}
        aria-label="Vista previa de correo transaccional"
      >
        <div className={styles.emailBar} style={{ background: palette.primary, color: palette.onPrimary }}>
          <BrandMark
            subdomain={subdomain}
            logoUrl={logoUrl}
            logoBroken={logoBroken}
            onLogoError={onLogoError}
            className={styles.emailLogo}
          />
          <span>{brandName}</span>
        </div>
        <div className={styles.emailBody}>
          <p className={styles.emailEyebrow}>Confirmación de compra</p>
          <h3>Tu boleto está listo</h3>
          <p>
            Gracias por tu compra. Este correo usa el color y el logo de tu marca. Las plantillas se
            generan al enviar; aquí solo ves cómo se verán.
          </p>
          <span
            className={styles.emailCta}
            style={{ background: palette.primary, color: palette.onPrimary }}
          >
            Ver boletos
          </span>
          <p className={styles.emailFoot}>{host}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={styles.previewShell}
      style={{ fontFamily: STOREFRONT_FONT }}
      aria-label="Vista previa del storefront"
    >
      <div className={styles.previewBar} style={{ background: palette.primary, color: palette.onPrimary }}>
        <div className={styles.previewBrand}>
          <BrandMark
            subdomain={subdomain}
            logoUrl={logoUrl}
            logoBroken={logoBroken}
            onLogoError={onLogoError}
            className={styles.logo}
          />
          <div>
            <p className={styles.previewName}>{brandName}</p>
            <p className={styles.previewHost}>{host}</p>
          </div>
        </div>
        <span
          className={styles.previewCta}
          style={{ background: palette.onPrimary, color: palette.primary }}
        >
          Comprar
        </span>
      </div>
      <div className={styles.previewBody}>
        <div className={styles.previewCard}>
          <div className={styles.previewCardHead}>
            <h3>Evento de ejemplo</h3>
            <Badge tone="info" variant="soft" size="sm">
              En venta
            </Badge>
          </div>
          <p>
            La barra, CTAs y acentos usan tu color primario. El texto sobre marca se elige
            automáticamente para mantener contraste accesible.
          </p>
          <div className={styles.previewActions}>
            <span
              className={styles.previewPrimaryBtn}
              style={{ background: palette.primary, color: palette.onPrimary }}
            >
              Seleccionar asientos
            </span>
            <span
              className={styles.previewGhostBtn}
              style={{ color: palette.primary, borderColor: palette.primary }}
            >
              Ver mapa
            </span>
          </div>
        </div>
        <div className={styles.tokenGrid} aria-label="Tokens aplicados">
          <div className={styles.token}>
            <span className={styles.tokenLabel}>Primary</span>
            <span className={styles.tokenSwatch} style={{ background: palette.primary }} aria-hidden="true" />
            <span className={styles.tokenValue}>{palette.primary}</span>
          </div>
          <div className={styles.token}>
            <span className={styles.tokenLabel}>On primary</span>
            <span className={styles.tokenSwatch} style={{ background: palette.onPrimary }} aria-hidden="true" />
            <span className={styles.tokenValue}>{palette.onPrimary}</span>
          </div>
          <div className={styles.token}>
            <span className={styles.tokenLabel}>Secundario</span>
            <span className={styles.tokenSwatch} style={{ background: palette.secondary }} aria-hidden="true" />
            <span className={styles.tokenValue}>{palette.secondary}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
