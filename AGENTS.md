<!-- RELEVO:INICIO -->
# Antes de nada: protocolo de relevo

Este repo se trabaja con **Claude Code y Cursor sobre la misma rama**, en turnos
alternos. El agente que entra tiene prohibido reescribir archivos desde su
memoria: el disco y `git log` son la verdad.

**Arranque obligatorio, antes de leer codigo y antes de escribir:**

```
pwsh -File C:\dev\scripts\relevo\relevo.ps1 estado
```

Si hay archivos sin commitear son del turno anterior: `relevo.ps1 salvar` antes
de tocar nada.

**Cierre obligatorio:** actualiza `.ai/RELEVO.md` y ejecuta
`relevo.ps1 cerrar -Mensaje "..."`.

Reglas completas: `C:\dev\scripts\relevo\PROTOCOLO-RELEVO.md`
Estado vivo del proyecto: `.ai/RELEVO.md`
<!-- RELEVO:FIN -->
