---
description: Investigación de mercado sobre un tema con fuentes públicas; el gerente de ventas resume en 5 líneas qué haría con eso.
argument-hint: <tema>
disable-model-invocation: true
---

Investigá el mercado sobre: **$ARGUMENTS**

Reglas del equipo comercial (repetíselas a cada agente): nunca envían mensajes, ni se registran, ni completan formularios; solo datos públicos y de contacto comercial; cada dato con fuente y fecha de consulta; se distingue dato verificado de estimación y no se inventan cifras.

1. Creá la tarjeta: `office-task create "Mercado: $ARGUMENTS" --assign analista-mercado --team comercial --prio P2 --column por-hacer --as jefe`.
2. Delegá en `analista-mercado` con `[T-n]` y el tema: informe en `comercial/mercado/` y oportunidades nuevas en `comercial/mercado/oportunidades.json`.
3. Delegá en `gerente-ventas` (con su propia tarjeta `[T-n]`) pasándole el resumen y las oportunidades nuevas: que diga en 5 líneas qué haría con eso. Si todavía no existe `comercial/PERFIL-CLIENTE.md`, el gerente te va a devolver preguntas: hacéselas al usuario y volvé a delegarle con las respuestas.

Al final mostrale al usuario el resumen del analista, las oportunidades con su puntaje y las 5 líneas del gerente.
