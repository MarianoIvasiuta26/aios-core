---
description: Prospección de clientes: el gerente confirma el segmento, el prospector busca leads y redacta borradores, y el gerente los revisa. Nunca se envía nada.
argument-hint: "[segmento]"
disable-model-invocation: true
---

Prospectá clientes. Segmento pedido: **$ARGUMENTS** (si está vacío, lo elige el gerente).

Reglas del equipo comercial (repetíselas a cada agente): nunca envían mensajes, ni se registran, ni completan formularios en ningún sitio, el usuario envía todo; solo datos públicos y de contacto comercial, nada de datos personales privados; cada dato con fuente y fecha de consulta.

1. Creá la tarjeta del gerente y delegá en `gerente-ventas` con `[T-n]`: que elija o confirme el segmento (según `comercial/ESTRATEGIA.md` y las oportunidades), defina cuántos leads buscar y los criterios de encaje, y cree la tarjeta del prospector. Si no hay perfil de cliente, te devuelve preguntas: hacéselas al usuario y volvé a delegarle.
2. Delegá en `prospector` con su `[T-n]`, el segmento y los criterios: leads en `comercial/leads.csv` y borradores en `comercial/borradores/`.
3. Delegá en `gerente-ventas` la revisión de los borradores (aprobado o cambios). Si pide cambios, volvé a delegar en el prospector con los comentarios (una vuelta) y que el gerente revise de nuevo.

Al final mostrale al usuario: leads nuevos, borradores aprobados (rutas) para que él los envíe, y los que quedaron con cambios. Recordale que nada se envió.
