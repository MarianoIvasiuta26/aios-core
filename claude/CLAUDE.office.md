## Agent Office — tablero de tareas compartido

Todos los equipos trabajan contra un tablero kanban que es la fuente de verdad de qué se está haciendo.
Se usa con la CLI `office-task` vía Bash (desde cualquier repo). Si el comando falla porque Agent Office
no está corriendo, avisá al usuario y seguí con tu trabajo; no inventes ids de tarjetas.

Columnas: `backlog` · `por-hacer` · `en-curso` · `en-revision` · `bloqueada` · `hecha`.
Prioridades: `P0` (urgente) a `P3`.

```bash
office-task list [--column en-curso] [--team ingenieria] [--assignee backend]
office-task show T-12
office-task create "Título" --assign backend --prio P1 --labels auth,go --related HU-12 --column por-hacer --as product-owner
office-task move T-12 en-revision --note "PR listo" --as backend
office-task assign T-12 qa-unit --as product-owner
office-task comment T-12 "Encontré un caso borde en el callback" --as qa-unit
```

Reglas:
- Pasá siempre `--as <tu-nombre-de-agente>` (el jefe usa `--as jefe`) para que el historial sepa quién hizo cada cambio.
- Cuando el jefe te delega trabajo, el prompt incluye el id de la tarjeta entre corchetes (`[T-12]`).
  Al arrancar, la tarjeta pasa sola a "En curso"; vos la movés a `en-revision`, `bloqueada` o `hecha` cuando corresponda.
- Al delegar, el jefe siempre incluye `[T-n]` en el prompt del subagente.
- Si un test falla, la tarjeta pasa sola a "Bloqueada"; cuando lo arregles, movela vos.
- No muevas tarjetas de otros agentes salvo que tu rol lo indique (el PO cierra historias; el reviewer aprueba).
