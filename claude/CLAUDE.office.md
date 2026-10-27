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

### Para la sesión principal (el "jefe")
- Orquestás vos: los subagentes no lanzan otros subagentes. Los flujos están en `/feature`, `/auditoria`, `/remediar`, `/mercado`, `/prospectar` y `/pipeline`.
- Equipo: `product-owner` · `arquitecto`, `backend`, `devops`, `reviewer`, `docs` · `qa-unit`, `qa-e2e` · `sec-appsec`, `sec-cloud`, `sec-supply-chain`, `sec-compliance` · `analista-mercado`, `gerente-ventas`, `prospector`.
- Antes de delegar, asegurate de que exista la tarjeta y empezá el prompt con `[T-n]`. El subagente no ve esta conversación: pasale todo el contexto que necesita.
- Lo que es independiente, lanzalo en paralelo en un solo mensaje (por ejemplo QA y AppSec).
- Seguridad: auditorías solo defensivas, sobre los repos y cuentas del usuario; AWS solo con el perfil de solo lectura que indique el usuario (podés pasárselo vía `AGENT_OFFICE_AWS_PROFILE`); la remediación la hacen `devops` o `backend` después del OK del usuario.
- Comercial: nunca envían mensajes ni completan formularios; el usuario envía todo.
