'use client';

import styles from '../Venue3DStudio.module.scss';

const TEMPLATES = [
  { id: 'arena' as const, label: 'Arena' },
  { id: 'theater' as const, label: 'Teatro' },
  { id: 'stadium' as const, label: 'Estadio' },
  { id: 'festival' as const, label: 'Festival' },
];

export type LayoutTemplateId = (typeof TEMPLATES)[number]['id'];

type TemplatesPanelProps = {
  busy: string | null;
  events: Array<{ id: string; title: string }>;
  publishEventId: string;
  onPublishEventIdChange: (id: string) => void;
  onApplyTemplate: (id: LayoutTemplateId) => void;
  onPublish: () => void;
  publishing: boolean;
};

export function TemplatesPanel({
  busy,
  events,
  publishEventId,
  onPublishEventIdChange,
  onApplyTemplate,
  onPublish,
  publishing,
}: TemplatesPanelProps) {
  return (
    <section className={styles.panel} aria-labelledby="studio-templates-title">
      <h2 id="studio-templates-title" className={styles.panelTitle}>
        Plantillas y publicación
      </h2>
      <div className={styles.panelBody}>
        <p className={styles.hint}>
          Genera el bowl en 3D. La planta 2D se arma con las mismas coordenadas.
        </p>
        <div className={styles.row}>
          {TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              className={styles.chipBtn}
              disabled={Boolean(busy)}
              onClick={() => onApplyTemplate(template.id)}
            >
              {busy === template.id ? '…' : template.label}
            </button>
          ))}
        </div>
        {events.length > 0 && (
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="publish-event">
              Publicar a evento
            </label>
            <select
              id="publish-event"
              className={styles.fieldSelect}
              value={publishEventId}
              onChange={(event) => onPublishEventIdChange(event.target.value)}
            >
              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.title}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={styles.chipBtnActive}
              disabled={!publishEventId || publishing}
              onClick={onPublish}
            >
              {publishing ? 'Publicando…' : 'Publicar a evento'}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
