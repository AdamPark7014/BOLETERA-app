# IA en Black Ticket (Boletera)

Guía del producto. Contrato global: `C:\dev\scripts\ai-os\IA-CLAUDE.md`.

## Funciones

| Función | `x-proceso` | Modelo | Entrada → salida | Sin token |
|---|---|---|---|---|
| Búsqueda en lenguaje natural | `boletera-buscar` | `claude-haiku-5-5` effort low | Frase → mismos filtros que el intérprete determinista (JSON schema) | Solo capa determinista |
| Asistente del comprador | `boletera-asistente` | `claude-haiku-5-5` effort low, stream | Pregunta + datos del evento → texto corto (≤400 tokens) | El botón no aparece |

Variables: `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY` (token en `C:\dev\secrets\puerta-ia\boletera.token`). El modelo **solo** se llama desde `apps/api` (módulo `smart-search`).

## Intérprete determinista

Archivo: `apps/api/src/modules/smart-search/query-interpreter.ts`.  
Zona horaria: `America/Mexico_City`. Entiende fechas relativas (hoy, mañana, sábado, domingo, este fin, próxima semana, diciembre), ciudades MX, categorías/géneros, tope de precio, personas, barato / cerca del escenario / accesible / niños.

## Eval (25 frases)

Frases: `apps/api/src/modules/smart-search/eval/phrases.json`.  
Correr:

```bash
pnpm --filter @boletera/api exec jest src/modules/smart-search/query-interpreter.spec.ts
node apps/api/src/modules/smart-search/eval/run.mjs
```

| # | Frase (resumen) | Esperado |
|---|---|---|
| 1 | rock sábado CDMX &lt;800 | MUSIC, rock, CDMX, maxPrice 800, sábado |
| 2 | niños domingo | kids, FAMILY, domingo |
| 3 | baratos clásico | cheap, SPORTS |
| 4 | conciertos hoy | MUSIC, hoy |
| 5 | teatro mañana Puebla | THEATER, Puebla, mañana |
| 6 | festival este fin | FESTIVAL, fin |
| 7 | comedia próxima semana | COMEDY, próxima semana |
| 8 | conciertos diciembre GDL | MUSIC, Guadalajara, diciembre |
| 9 | cerca del escenario | nearStage |
| 10 | accesible León | accessible, León |
| 11 | standup 4 Monterrey | COMEDY, partySize 4, Monterrey |
| 12 | cine hasta 500 | CINEMA, maxPrice 500 |
| 13 | pop Cancún | MUSIC, pop, Cancún |
| 14 | indie barato | MUSIC, indie, cheap |
| 15 | metal Querétaro | MUSIC, metal, Querétaro |
| 16 | fútbol sábado | SPORTS, sábado |
| 17 | obra domingo | THEATER, domingo |
| 18 | familia fin Toluca | kids, Toluca, fin |
| 19 | reggaeton &lt;1200 CDMX | reggaeton, maxPrice, CDMX |
| 20 | primera fila concierto | nearStage, MUSIC |
| 21 | silla de ruedas comedia | accessible, COMEDY |
| 22 | económico Mérida | cheap, Mérida |
| 23 | festival Tijuana | FESTIVAL, Tijuana |
| 24 | música próxima semana GDL | MUSIC, Guadalajara, próxima semana |
| 25 | quiero ver eventos | (sin filtros fuertes) |

## Fila para la guía global (§7)

| Proyecto | Función de IA | Modelo | Desde | Token |
|---|---|---|---|---|
| Boletera | Buscador NL (`boletera-buscar`) y asistente del comprador (`boletera-asistente`) | `claude-haiku-5-5`, effort low; búsqueda con salida JSON; asistente en stream ≤400 tokens. Eval determinista en `apps/api/src/modules/smart-search/eval`. Hoy el token puede responder 401: el producto funciona sin IA. | `boletera-api` | `C:\dev\secrets\puerta-ia\boletera.token` |

(Copia esta fila a `C:\dev\scripts\ai-os\IA-CLAUDE.md` §7 cuando Adam lo pida; este doc no edita la guía global.)
