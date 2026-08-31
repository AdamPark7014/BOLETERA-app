# RELEVO

- **Último turno:** claude-code
- **Fecha:** 2026-08-31
- **Rama:** mejora/worker-y-tests

## Lo primero que tiene que saber quien entre

**Este turno no tocó código.** Solo se agregó documentación de producto:
`docs/PERSONAS.md`. El último estado de código sigue siendo el de Cursor
(**Wave 5**: SEO megapresencia multi-tenant, QR vivo, P0 aislamiento API, stubs
honestos, orgName en taquilla, sobre Wave 4). Nada de lo pendiente cambió.

## Hecho en este turno

### docs/PERSONAS.md (nuevo)
Personas de usuario siguiendo el método de los 5 pasos (datos → diferencias →
hipótesis → acuerdo de stakeholders → número de personas con foco en una):

- **Primaria:** la promotora independiente (`PROMOTER`, `apps/admin`).
- **Secundarias:** el comprador de último minuto (`CUSTOMER`, `apps/web`); la
  taquillera (`TAQUILLA`, `apps/taquilla`); el operador del recinto
  (`VENUE_MANAGER`, acceso + mapas); la contadora del promotor (`FINANCE`,
  reportes/payouts/billing).
- **Antipersona:** el revendedor.
- Las personas se identifican por **puesto**, no por nombre propio (decisión de Adam).
- 5 hipótesis falsables (H1–H5) con su prueba y qué las tira, más plan de
  validación de 3 semanas.

Están construidas sobre lo que el repo ya modela (`UserRole`, `SalesChannel`,
métodos de pago CARD/SPEI/OXXO/CASH, PIN de cash-drop, corte Z, QR vivo, refunds
con cierre manual, CFDI sandbox). Marcadas explícitamente como **hipótesis**, no
como investigación de campo: nadie ha entrevistado usuarios todavía.

### Entregables fuera del repo
- Artifact publicado (versión presentable del mismo documento).
- PDF A4 de 10 páginas en `C:\Users\adpoz\Documents\Personas-Boletera.pdf`
  (generado con Chrome headless desde el HTML del artifact; el script queda en el
  scratchpad de la sesión, no en el repo).

## Pendiente
- Probar tenants A vs B con hosts distintos (manual / Docker) + Rich Results Test
  en un evento real.
- Load scenarios E2E con API arriba.
- Ola 6 candidata: resale buyer checkout incompleto; métricas worker DLQ.
- Refunds Banorte portal-manual / auto API; JWT httpOnly/CSRF; decidir
  `enterprise-upgrade`.
- PAC CFDI real (producción); bank rail payouts.
- **Nuevo:** las personas están sin firmar (paso 04 del método). Antes de usarlas
  para priorizar hay que cerrar la sesión de acuerdo y resolver H1/H3.

## No tocar
- `*.env.docker-backup`, worktree `integracion/dinero`, rama `enterprise-upgrade`.
- Banorte auto-refund API, JWT httpOnly/CSRF end-to-end, PAC CFDI real, bank payouts.
