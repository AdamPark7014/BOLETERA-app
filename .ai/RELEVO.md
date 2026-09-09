# RELEVO

- **Último turno:** claude-code
- **Fecha:** 2026-09-09
- **Rama:** mejora/worker-y-tests

## Lo primero que tiene que saber quien entre

**Este turno tampoco tocó código de la app.** Solo `docs/`: se rehízo la
presentación de la persona «comprador de último minuto» como entregable de la
materia Interacción Humano-Computadora. El último estado de código sigue siendo
el de Cursor (**Wave 5**). Nada de lo pendiente cambió.

## Hecho en este turno

### La presentación (docs/Persona-Ivan-Solis.pdf)
Pasó de 2 láminas en inglés a **4 láminas en español, 16:9 (13.333 × 7.5 in)**,
listas para proyectar:

1. Portada — curso, entrega, autor, fecha, los 5 pasos del método con su estado
   y el aviso de honestidad (estas personas no vienen de entrevistas).
2. La persona — retrato, ficha, cita, quiere / lo quema, los cinco ejes de
   diferenciación con medidores, y el momento clave.
3. Mapa de empatía — cuatro cuadrantes alrededor del retrato + dolores/ganancias.
4. De la evidencia al diseño — curva de ánimo de las 7 fases del journey, el
   hallazgo verificado, y obliga a construir / ya resuelto / cómo se mide.

Fuente: `docs/assets/persona-ivan-solis.html`. Se renderiza con Chrome headless:

```
"C:/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu \
  --no-pdf-header-footer --run-all-compositor-stages-before-draw --virtual-time-budget=9000 \
  --print-to-pdf="docs/Persona-Ivan-Solis.pdf" "file:///.../docs/assets/persona-ivan-solis.html"
```

### Hallazgo verificado nuevo — refina O3
El turno anterior dejó diagnosticado que `EventPurchaseClient.tsx:658` rotula
«Total $…» sobre una suma de `basePrice`. **Este turno encontró algo más
concreto:** ese mismo componente ya recibe `minPriceAllIn` —documentado en el
propio archivo como «Precio final al comprador (cargos e IVA incluidos)»— y lo
usa en la línea 659 para la etiqueta «Desde $…». O sea: el número honesto ya
está en la pantalla; en cuanto el usuario elige asiento, la interfaz cambia al
incompleto. El arreglo de O3 en esa pantalla no necesita datos nuevos.

**Sigue sin arreglarse. Nadie tocó ese archivo.** Falta reflejarlo en
`docs/UX-MAPS.md` §03 y §10, que todavía lo cuenta con el encuadre anterior.

### Fuentes locales (docs/assets/fonts/)
El PDF ya no depende de la red ni de fuentes del sistema. Dos trampas resueltas
que conviene no repetir:

- Instrument Sans en Google Fonts es **variable**, y Chrome no sabe incrustar
  una variable en el PDF: la convierte en fuentes **Type3** (contornos
  dibujados, texto no seleccionable, archivo mucho más grande). Se generaron
  instancias estáticas 400/500/600/700 con `fontTools.varLib.instancer`.
- En los subconjuntos de Google, el archivo **`latin` es el grande** (~206
  glifos: ASCII, acentos, « », guiones) y `latinext` el chico (~123). Tenerlos
  al revés en `unicode-range` hace que **todo** el texto normal caiga a Georgia
  y Segoe UI sin que el render falle de forma visible. Los archivos ahora están
  nombrados por lo que de verdad cubren.

Verificación del PDF: 0 fuentes Type3, 0 respaldos del sistema, todo Type0/CID.

### Entregable fuera del repo
`OneDrive/Documentos/Universidad/2026-Semestre-5/01-Interaccion-Humano-Computadora-CN220/Entregas/`
→ `2026-09-09 Persona y mapa de empatía - Adam Del Pozo Ontiveros.pdf`

## Pendiente
- Probar tenants A vs B con hosts distintos (manual / Docker) + Rich Results Test
  en un evento real.
- Load scenarios E2E con API arriba.
- Ola 6 candidata: resale buyer checkout incompleto; métricas worker DLQ.
- Refunds Banorte portal-manual / auto API; JWT httpOnly/CSRF; decidir
  `enterprise-upgrade`.
- PAC CFDI real (producción); bank rail payouts.
- Las personas siguen **sin firmar** (paso 04 del método). Antes de usarlas para
  priorizar hay que cerrar la sesión de acuerdo y resolver H1/H3.
- O3 (total real desde la página del evento) y O4 (contador de cola offline en
  taquilla) son los dos candidatos de código con evidencia verificada. Ninguno
  está comprometido: entran a la sesión de acuerdo, no al sprint.
- El embudo móvil evento→carrito→pago no existe como evento instrumentado. Sin
  eso, H2 no se resuelve.
- **Nuevo:** actualizar `docs/UX-MAPS.md` con el hallazgo de `minPriceAllIn`.

## No tocar
- `*.env.docker-backup`, worktree `integracion/dinero`, rama `enterprise-upgrade`.
- `docs/assets/fonts/` — los `.woff2` son binarios generados; regenerarlos solo
  con las instrucciones del encabezado de `local.css`.
