---
description: Lleva una funcionalidad de punta a punta con el equipo (PO → arquitecto → implementación → QA y AppSec en paralelo → review → validación del PO), moviendo las tarjetas del tablero.
argument-hint: <descripción de la funcionalidad>
disable-model-invocation: true
---

Orquestá la funcionalidad: **$ARGUMENTS**

Sos el jefe: no implementás vos, delegás en los subagentes y coordinás. Cada vez que delegues, el prompt del subagente empieza con el id de su tarjeta entre corchetes (`[T-n]`) y trae todo el contexto que necesita (no ve esta conversación).

1. **Historia.** Creá la tarjeta de la historia: `office-task create "Historia: <título corto>" --assign product-owner --team producto --prio P1 --column por-hacer --as jefe`.
   Delegá en `product-owner` con `[T-n]`: que escriba la historia con criterios de aceptación en `docs/BACKLOG.md` y cree una tarjeta para cada etapa: diseño (`arquitecto`), implementación (`backend` y/o `devops`), tests unitarios (`qa-unit`), E2E (`qa-e2e`), AppSec (`sec-appsec`) y review (`reviewer`). Pedile que te devuelva los criterios y los `T-n`.
2. **Diseño.** Delegá en `arquitecto` con su `[T-n]`, la historia y los criterios.
3. **Implementación.** Delegá en `backend` y/o `devops` (según el diseño; si son los dos, en paralelo en un mismo mensaje) con su `[T-n]`, el diseño completo y los criterios.
4. **Verificación en paralelo.** En un solo mensaje, lanzá `qa-unit`, `qa-e2e` y `sec-appsec`, cada uno con su `[T-n]`, los criterios y la lista de archivos cambiados. Un hallazgo Crítico o Alto de AppSec bloquea el cierre.
5. **Review.** Delegá en `reviewer` con su `[T-n]` y el alcance del diff.
6. **Si QA, AppSec o el review fallan**, volvé al paso 3 con las fallas concretas (tests, hallazgos, observaciones) para el implementador, y repetí 4 y 5. Después de 3 vueltas sin éxito, pará y preguntale al usuario cómo seguir.
7. **Cierre.** Delegá en `product-owner` con `[T-n]` de la historia: que valide cada criterio con la evidencia (reporte de QA, review) y cierre las tarjetas.

Al final, contale al usuario en pocas líneas: qué se hizo, archivos cambiados, estado de los tests y de seguridad, y tarjetas cerradas o pendientes. No hagas `git push` ni deploys.
