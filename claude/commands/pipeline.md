---
description: El gerente de ventas presenta el estado del pipeline comercial y los próximos pasos.
disable-model-invocation: true
---

Pedile a `gerente-ventas` el estado del pipeline. Creá antes su tarjeta (`office-task create "Revisión de pipeline" --assign gerente-ventas --team comercial --prio P3 --column por-hacer --as jefe`) y pasale el `[T-n]`.

Que lea `comercial/pipeline.md`, `comercial/leads.csv` y `comercial/borradores/`, y te devuelva:
- cantidad por etapa (lead → contactado → reunión → propuesta → ganado/perdido) y cambios desde la última revisión;
- los próximos pasos concretos con fecha, indicando cuáles tiene que hacer el usuario (el equipo nunca contacta a nadie);
- riesgos (oportunidades frenadas, borradores sin enviar).

Si el usuario te cuenta novedades de algún contacto en este pedido ($ARGUMENTS), pasáselas al gerente para que actualice el pipeline.

Mostrale al usuario el resumen tal cual, breve.
