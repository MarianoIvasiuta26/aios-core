---
description: Auditoría de seguridad defensiva (app, cloud, supply-chain o completa) con los auditores en paralelo y el informe consolidado de compliance.
argument-hint: "[app|cloud|supply-chain|completa]"
disable-model-invocation: true
---

Corré una auditoría de seguridad. Alcance pedido: **$ARGUMENTS** (si está vacío, es `completa`).

Alcances: `app` → `sec-appsec` · `cloud` → `sec-cloud` · `supply-chain` → `sec-supply-chain` · `completa` → los tres.

Reglas (obligatorias, repetiselas a cada auditor en su prompt):
- 100% defensiva, solo sobre este repo y las cuentas del usuario. Nada de escaneos activos, explotación ni pruebas contra terceros.
- AWS solo con el perfil de solo lectura que indique el usuario (`SecurityAudit` + `ViewOnlyAccess`); nunca se modifican recursos.
- Nunca se muestra ni se guarda el valor de un secreto: archivo, línea, tipo y últimos 4 caracteres.
- Si falta una herramienta, se informa y se propone cómo instalarla; nunca se inventan resultados.

Pasos:
1. Si el alcance incluye `cloud` y el usuario no indicó el perfil de AWS (ni está en `AGENT_OFFICE_AWS_PROFILE`), preguntáselo antes de seguir. Si no tiene uno, auditá solo Terraform.
2. Por cada auditor del alcance, creá su tarjeta: `office-task create "Auditoría <alcance> <fecha>" --assign <auditor> --team seguridad --prio P1 --column por-hacer --as jefe`.
3. Lanzá a los auditores **en paralelo, en un solo mensaje**, cada uno con su `[T-n]`, el alcance y el perfil de AWS si corresponde.
4. Cuando terminen, creá la tarjeta de `sec-compliance` y delegale con `[T-n]` la consolidación: duplicados, prioridades, mapeo CIS/ISO 27001, informe ejecutivo, plan de remediación y postura (0–100).

Al final mostrale al usuario: el informe ejecutivo, conteos por severidad, la postura, las herramientas que faltan (con el comando para instalarlas) y la ruta del informe. Aclarale que nada se remedió: para arreglar un hallazgo, `/remediar SEC-n`.
