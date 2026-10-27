---
description: Remedia un hallazgo de seguridad (SEC-n): el PO crea la historia y la tarjeta, el agente que corresponde implementa el fix y el auditor original verifica que quedó resuelto.
argument-hint: <SEC-n>
disable-model-invocation: true
---

Remediá el hallazgo **$ARGUMENTS**. Que el usuario corra este comando es su OK para arreglar este hallazgo (y solo este).

1. Leé el hallazgo en `docs/security/hallazgos.json` (y su sección en `docs/security/AUDITORIA-*.md`). Si no existe, decíselo al usuario y pará. Anotá el `auditor` original y el `componente`.
2. Delegá en `product-owner` (creá antes su tarjeta y pasale el `[T-n]`): historia técnica "Remediar $ARGUMENTS" con criterios de aceptación verificables (por ejemplo, "Checkov no reporta CKV_AWS_20 en infra/s3.tf") y una tarjeta de implementación con `--related $ARGUMENTS`, asignada a:
   - `devops` si es infraestructura, AWS, Docker o CI;
   - `backend` si es código de la aplicación o dependencias.
   - Si es un secreto expuesto: la rotación la hace el usuario; decíselo con claridad. El implementador solo lo saca del código y del historial si el usuario lo pide.
3. Delegá en el implementador con su `[T-n]`, el hallazgo completo y los criterios. Si el arreglo requiere aplicar cambios en AWS (`terraform apply` u otros), primero mostrale el `plan` al usuario y pedile OK explícito.
4. Delegá en el auditor original con una tarjeta de verificación `[T-n]`: que vuelva a correr la herramienta sobre el componente, confirme que el hallazgo ya no aparece y actualice su `estado` a `resuelto` en `docs/security/hallazgos.json` (o explique por qué sigue abierto).
5. Si la verificación falla, volvé al paso 3 con el detalle (máximo 2 vueltas; después consultá al usuario).

Al final contale al usuario qué se cambió, cómo se verificó y el nuevo estado del hallazgo.
