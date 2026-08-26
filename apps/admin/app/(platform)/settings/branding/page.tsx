'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Input,
  KpiCard,
  PageHeader,
  Section,
  SegmentedControl,
  Skeleton,
} from '@boletera/ui';
import { QueryError } from '@/components/QueryStates';
import { adminApi, getStoredToken } from '@/lib/api';
import { useBranding } from '@/lib/queries/branding';
import { useSession } from '@/lib/use-session';
import { BrandPreviews, type PreviewSurface } from './BrandPreviews';
import {
  contrastRatio,
  derivePalette,
  draftsEqual,
  formatRatio,
  gradeContrast,
  gradeLabel,
  mapServerErrors,
  normalizeHex,
  readLogoFileAsDataUrl,
  toDraft,
  toPayload,
  validateBrandingDraft,
  type BrandDraft,
  type FieldErrors,
  type ThemeSnapshot,
} from './branding-utils';
import styles from './branding.module.scss';

const PREVIEW_OPTIONS = [
  { value: 'storefront' as const, label: 'Storefront' },
  { value: 'ticket' as const, label: 'Boleto' },
  { value: 'email' as const, label: 'Correo' },
];

type SaveNotice = 'saved' | 'error' | null;

export default function BrandingPage() {
  const { can } = useSession();
  const brandingQuery = useBranding();
  const canEdit = can('settings.branding');

  const [draft, setDraft] = useState<BrandDraft | null>(null);
  const [savedDraft, setSavedDraft] = useState<BrandDraft | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState<SaveNotice>(null);
  const [previewSurface, setPreviewSurface] = useState<PreviewSurface>('storefront');
  const [logoBroken, setLogoBroken] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const theme = brandingQuery.data as ThemeSnapshot | undefined;

  useEffect(() => {
    if (!theme || draft) return;
    const initial = toDraft(theme);
    setDraft(initial);
    setSavedDraft(initial);
  }, [theme, draft]);

  const palette = useMemo(
    () => derivePalette(draft?.primaryColor ?? '', theme?.secondaryColor),
    [draft?.primaryColor, theme?.secondaryColor],
  );

  const onWhiteContrast = useMemo(() => {
    if (!draft) return null;
    return contrastRatio(normalizeHex(draft.primaryColor), '#ffffff');
  }, [draft]);

  const onPrimaryContrast = useMemo(() => {
    if (!draft) return null;
    return contrastRatio(palette.onPrimary, palette.primary);
  }, [draft, palette.onPrimary, palette.primary]);

  const dirty = useMemo(() => {
    if (!draft || !savedDraft) return false;
    return !draftsEqual(draft, savedDraft);
  }, [draft, savedDraft]);

  const patchDraft = useCallback((patch: Partial<BrandDraft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setFieldErrors({});
    setLogoBroken(false);
    setSaveNotice(null);
  }, []);

  const onLogoFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      try {
        const dataUrl = await readLogoFileAsDataUrl(file);
        patchDraft({ logoUrl: dataUrl });
      } catch (err) {
        setFieldErrors({
          logoUrl: err instanceof Error ? err.message : 'No se pudo leer el logo.',
        });
      }
    },
    [patchDraft],
  );

  const save = useCallback(async () => {
    if (!draft || !canEdit) return;
    const validation = validateBrandingDraft(draft);
    if (Object.keys(validation).length > 0) {
      setFieldErrors(validation);
      setSaveNotice('error');
      return;
    }

    const token = getStoredToken();
    if (!token) return;

    setSaving(true);
    setFieldErrors({});
    setSaveNotice(null);
    try {
      await adminApi('/admin/branding', token, {
        method: 'POST',
        body: JSON.stringify(toPayload(draft)),
      });
      const next = { ...draft, primaryColor: normalizeHex(draft.primaryColor) };
      setSavedDraft(next);
      setDraft(next);
      setSaveNotice('saved');
    } catch (err) {
      setFieldErrors(mapServerErrors(err));
      setSaveNotice('error');
    } finally {
      setSaving(false);
    }
  }, [canEdit, draft]);

  if (brandingQuery.isLoading || !draft) {
    return (
      <div className={styles.page}>
        <PageHeader
          eyebrow="Configuración"
          title="Marca"
          description="Color, subdominio y logo de tu storefront white-label"
        />
        <div className={styles.skeletonLayout}>
          <Skeleton height={320} />
          <Skeleton height={320} />
        </div>
      </div>
    );
  }

  if (brandingQuery.isError) {
    return (
      <QueryError error={brandingQuery.error} onRetry={() => void brandingQuery.refetch()} />
    );
  }

  const hostPreview = `${draft.subdomain.trim().toLowerCase() || 'demo'}.boletera.app`;
  const contrastGrade = onWhiteContrast !== null ? gradeContrast(onWhiteContrast) : 'fail';

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Configuración"
        title="Marca"
        description="Personaliza el color, subdominio y logo que ven tus compradores en el storefront y los correos transaccionales."
        actions={
          canEdit ? (
            <Button
              type="button"
              onClick={() => void save()}
              loading={saving}
              loadingLabel="Guardando…"
              disabled={!dirty && saveNotice !== 'error'}
            >
              Guardar cambios
            </Button>
          ) : undefined
        }
      >
        <div className={styles.kpiRow}>
          <KpiCard
            label="Contraste sobre blanco"
            value={onWhiteContrast !== null ? formatRatio(onWhiteContrast) : '—'}
            tone={
              contrastGrade === 'fail'
                ? 'danger'
                : contrastGrade === 'aaa'
                  ? 'success'
                  : 'warning'
            }
            hint={`Nivel ${gradeLabel(contrastGrade)} · texto sobre marca ${onPrimaryContrast !== null ? formatRatio(onPrimaryContrast) : '—'}`}
          />
          <KpiCard
            label="Subdominio"
            value={draft.subdomain || '—'}
            tone="info"
            hint={hostPreview}
          />
          <KpiCard
            label="Logo"
            value={draft.logoUrl ? 'Configurado' : 'Sin logo'}
            tone={draft.logoUrl ? 'success' : 'neutral'}
            hint={draft.logoUrl ? 'Se muestra en storefront y boletos' : 'Se usa la inicial del subdominio'}
          />
        </div>
      </PageHeader>

      {!canEdit && (
        <div className={styles.permissionBanner} role="status">
          Solo administradores pueden editar la marca. Puedes revisar la vista previa.
        </div>
      )}

      {dirty && canEdit && (
        <div className={`${styles.statusBanner} ${styles.statusDirty}`} role="status">
          Hay cambios sin guardar.
        </div>
      )}
      {saveNotice === 'saved' && !dirty && (
        <div className={`${styles.statusBanner} ${styles.statusSaved}`} role="status">
          Marca guardada correctamente.
        </div>
      )}
      {fieldErrors.form && (
        <p className={styles.formError} role="alert">
          {fieldErrors.form}
        </p>
      )}

      <div className={styles.layout}>
        <div className={styles.editorCol}>
          <Section title="Identidad visual" description="Color primario y logo de tu organización.">
            <div className={styles.fields}>
              <div className={styles.colorRow}>
                <div className={styles.swatchWrap}>
                  <span className={styles.swatchLabel}>Muestra</span>
                  <input
                    type="color"
                    className={styles.swatch}
                    value={normalizeHex(draft.primaryColor)}
                    onChange={(e) => patchDraft({ primaryColor: e.target.value })}
                    disabled={!canEdit}
                    aria-label="Selector de color primario"
                  />
                </div>
                <Input
                  label="Color primario"
                  value={draft.primaryColor}
                  onChange={(e) => patchDraft({ primaryColor: e.target.value })}
                  error={fieldErrors.primaryColor}
                  hint="Hexadecimal (#RRGGBB). Se aplica a barras, botones y acentos."
                  disabled={!canEdit}
                  requiredMark
                />
              </div>

              <div className={styles.paletteRow} aria-label="Paleta derivada">
                {(
                  [
                    ['Primario', palette.primary],
                    ['Sobre primario', palette.onPrimary],
                    ['Secundario', palette.secondary],
                    ['Acento suave', palette.accentSoft],
                  ] as const
                ).map(([label, color]) => (
                  <div key={label} className={styles.paletteChip}>
                    <span style={{ background: color }} aria-hidden="true" />
                    <div>
                      <strong>{label}</strong>
                      <code>{color}</code>
                    </div>
                  </div>
                ))}
              </div>

              <div className={styles.logoRow}>
                <div className={styles.logoPreviewBox}>
                  {draft.logoUrl && !logoBroken ? (
                    // eslint-disable-next-line @next/next/no-img-element -- remote / data URL from organizer
                    <img
                      src={draft.logoUrl}
                      alt=""
                      onError={() => setLogoBroken(true)}
                    />
                  ) : (
                    <span aria-hidden="true">
                      {(draft.subdomain || 'B').slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </div>
                <div className={styles.logoFields}>
                  <Input
                    label="URL del logo"
                    value={draft.logoUrl}
                    onChange={(e) => patchDraft({ logoUrl: e.target.value })}
                    error={fieldErrors.logoUrl}
                    hint="HTTPS o archivo pequeño (PNG, SVG, JPG, WebP)."
                    disabled={!canEdit}
                    placeholder="https://cdn.ejemplo.com/logo.svg"
                  />
                  {canEdit && (
                    <div className={styles.logoActions}>
                      <input
                        ref={fileRef}
                        type="file"
                        accept="image/*"
                        className={styles.srOnly}
                        onChange={(e) => void onLogoFile(e.target.files?.[0])}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => fileRef.current?.click()}
                      >
                        Subir archivo
                      </Button>
                      {draft.logoUrl && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => patchDraft({ logoUrl: '' })}
                        >
                          Quitar logo
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Section>

          <Section
            title="Subdominio"
            description="Dirección pública de tu storefront en Boletera."
          >
            <div className={styles.fields}>
              <Input
                label="Subdominio"
                value={draft.subdomain}
                onChange={(e) => patchDraft({ subdomain: e.target.value.toLowerCase() })}
                error={fieldErrors.subdomain}
                hint={`Tu storefront estará en ${hostPreview}`}
                disabled={!canEdit}
                requiredMark
                trailing={<span>.boletera.app</span>}
              />
              {theme?.customDomain ? (
                <div className={styles.domainReadonly}>
                  <strong>Dominio personalizado</strong>
                  <code>{theme.customDomain}</code>
                  <p>Configurado por soporte — no editable desde aquí.</p>
                </div>
              ) : (
                <p className={styles.domainHint}>
                  Para un dominio propio (p. ej. boletos.tumarca.com) contacta a soporte.
                </p>
              )}
            </div>
          </Section>

          <Section title="Tipografía" description="Fuentes usadas en las vistas previas.">
            <div className={styles.typeSpecimen}>
              <p className={styles.typeLabel}>Storefront y correo</p>
              <p className={styles.typeHeadline} style={{ color: palette.primary }}>
                {draft.subdomain || 'Tu marca'}
              </p>
              <p className={styles.typeBody}>
                El texto sobre color de marca se elige automáticamente para cumplir contraste
                accesible (WCAG).
              </p>
            </div>
          </Section>
        </div>

        <aside className={styles.previewCol}>
          <div className={styles.previewSticky}>
            <div className={styles.previewHeader}>
              <div>
                <h2>Vista previa</h2>
                <p>Así se verá tu marca en cada superficie.</p>
              </div>
              <SegmentedControl
                label="Superficie de vista previa"
                options={PREVIEW_OPTIONS}
                value={previewSurface}
                onValueChange={setPreviewSurface}
                size="sm"
              />
            </div>
            <div className={styles.previewFrame}>
              <BrandPreviews
                surface={previewSurface}
                palette={palette}
                subdomain={draft.subdomain}
                logoUrl={draft.logoUrl}
                logoBroken={logoBroken}
                onLogoError={() => setLogoBroken(true)}
                customDomain={theme?.customDomain}
              />
            </div>
            <p className={styles.previewCaption}>
              Los cambios se reflejan al instante; guarda para aplicarlos en producción.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
