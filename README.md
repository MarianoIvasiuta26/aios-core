# Agent Office

Una oficina pixel art que muestra en vivo qué hacen tus subagentes de Claude Code. La sesión principal es el **jefe** y hay 15 agentes en cinco equipos: Producto, Ingeniería, QA, Seguridad y Comercial. Todos trabajan contra un tablero kanban compartido.

Cada sesión de Claude Code que abras, en cualquier repo, aparece como un **piso**. En ese piso ves:

- los agentes que entran por la puerta, escriben, corren comandos, buscan en la web o piden permiso;
- las tarjetas que se mueven por el tablero de la pared;
- las zonas, que reaccionan a los archivos que los agentes dejan en el repo (backlog, reportes de QA, hallazgos de seguridad, leads y otros).

Agent Office solo **observa**. Si está apagada, Claude Code funciona igual, sin errores ni demoras.

## Requisitos

| Para | Qué | Notas |
|---|---|---|
| La oficina | Node.js 22 o superior | |
| La oficina | pnpm | Viene con Node vía Corepack (ver Instalación) |
| La oficina | `curl` | Lo usa el hook para mandar los eventos |
| Los agentes | Claude Code | Con las sesiones abiertas **después** de instalar |

### Herramientas de los equipos

Hacen falta en la máquina donde corren los agentes, solo para los equipos que vayas a usar. Si un agente no encuentra una, te dice cómo instalarla y no inventa resultados.

| Herramienta | La usa | Instalación sugerida |
|---|---|---|
| [Go](https://go.dev/dl/) (incluye `gofmt` y `go test`) | backend, qa-unit | Tarball oficial de go.dev o `brew install go` |
| [golangci-lint](https://golangci-lint.run/welcome/install/) | backend, reviewer | Binario oficial o `brew install golangci-lint` |
| [govulncheck](https://go.dev/doc/tutorial/govulncheck) | sec-appsec | `go install golang.org/x/vuln/cmd/govulncheck@latest` |
| [gosec](https://github.com/securego/gosec) | sec-appsec | `go install github.com/securego/gosec/v2/cmd/gosec@latest` |
| [Semgrep](https://semgrep.dev/docs/getting-started/) | sec-appsec | `pipx install semgrep` o `brew install semgrep` |
| [Checkov](https://www.checkov.io/2.Basics/Installing%20Checkov.html) | sec-cloud | `pipx install checkov` |
| [Trivy](https://trivy.dev/latest/getting-started/installation/) | sec-cloud, sec-supply-chain | Repositorio oficial de Aqua o `brew install trivy` |
| [Prowler](https://docs.prowler.com/) | sec-cloud | `pipx install prowler` |
| [gitleaks](https://github.com/gitleaks/gitleaks) | sec-supply-chain | Binario oficial o `brew install gitleaks` |
| [Syft](https://github.com/anchore/syft) (opcional) | sec-supply-chain | Para el SBOM; si no está, se usa Trivy |
| [Playwright](https://playwright.dev/docs/intro) | qa-e2e | En el repo de trabajo: `npx playwright install --with-deps chromium` |
| PHP 8, Composer, PHPUnit/Pest (opcional) | backend, qa-unit, sec-appsec | Solo para repos Laravel/PHP |

Para auditar AWS, `sec-cloud` necesita un **perfil de solo lectura** con las políticas `SecurityAudit` y `ViewOnlyAccess`. Pasáselo en el pedido o fijalo antes de abrir `claude`:

```bash
export AGENT_OFFICE_AWS_PROFILE=auditoria-ro
```

Con esa variable definida, la guardia rechaza cualquier comando `aws` o `prowler` que use otro perfil.

## Instalación

```bash
git clone <este repo> ~/projects/aios-core && cd ~/projects/aios-core
corepack enable --install-directory ~/.local/bin   # pnpm sin sudo
pnpm install
pnpm test                                          # opcional: 139 tests

pnpm office install --dry-run   # muestra qué cambiaría en ~/.claude, sin escribir nada
pnpm office install
pnpm office status
```

Qué hace `pnpm office install`:

- **`~/.claude/settings.json`:** agrega hooks asíncronos para los 10 eventos y deja un backup en `~/.claude/backups/`. Fusiona con tus hooks y claves existentes, no los pisa. Se puede correr más de una vez.
- **`~/.claude/agents/` y `~/.claude/commands/`:** symlinks a los 15 agentes y los 6 comandos de `claude/`.
- **`~/.local/bin/office-task` y `office-guard`:** la CLI del tablero y la guardia de los equipos.
- **`~/.claude/CLAUDE.md`:** agrega al final un bloque `agent-office` con las reglas del tablero.

Los hooks y los enlaces apuntan a esta carpeta: si movés el repo, volvé a instalar. Para deshacer todo:

```bash
pnpm office uninstall   # también acepta --dry-run
```

## Uso

```bash
pnpm dev    # server en :4317 y web en http://localhost:5173
```

Después abrí una sesión **nueva** de `claude` en el repo donde quieras trabajar y usá los comandos:

| Comando | Qué hace |
|---|---|
| `/feature <idea>` | PO → arquitecto → backend → QA y AppSec en paralelo → reviewer → PO valida |
| `/auditoria [app\|cloud\|supply-chain\|completa]` | Auditoría defensiva con los auditores en paralelo; compliance consolida |
| `/remediar <SEC-n>` | El PO crea la historia, devops o backend arreglan el hallazgo y el auditor original verifica |
| `/mercado <tema>` | El analista investiga con fuentes públicas y el gerente resume qué haría |
| `/prospectar [segmento]` | El gerente elige foco, el prospector busca leads y redacta borradores, el gerente los revisa |
| `/pipeline` | Estado del pipeline comercial y próximos pasos |

Para probar la interfaz sin Claude Code, usá **Iniciar demo**. Recorre un `/feature`, una `/auditoria` y un `/prospectar` con eventos simulados. Escribe archivos de ejemplo en `/tmp/agent-office-demo` y borra sus tarjetas al detenerse.

### En la oficina

- **Clic en un agente:** abre su panel con el estado, las tarjetas, los archivos, los comandos y la actividad.
- **Clic en una zona:** muestra su equipo y los datos de sus archivos (backlog, último reporte de QA, hallazgos, oportunidades y leads).
- **Línea de tiempo (abajo):** se filtra por tipo, equipo, agente o texto. Al hacer clic en una fila se centra el agente.
- **Controles (abajo a la derecha):** zoom, pausa (también con la tecla <kbd>espacio</kbd>) y velocidad.
- **Barra de arriba:** el tema (del sistema, oscuro de noche o claro de día) y el sonido, apagado de entrada.
- **Al recargar** se recuerdan el tema, el sonido, la velocidad, la cámara, la línea de tiempo y el piso fijado. Lo que pasó en cada piso se reconstruye desde el server.

### Archivos que lee la oficina

Se leen del repo de la sesión, o de `AGENT_OFFICE_WORKSPACE` si está definida. Los formatos están en `claude/agents/*.md`.

| Archivo | Se ve en |
|---|---|
| `docs/BACKLOG.md` | Corcho de Producto |
| `docs/qa/REPORTE-<fecha>.md` | Semáforo de QA (el reporte más reciente) |
| `docs/security/hallazgos.json` | Pantallas, radar y alarma del SOC. Un hallazgo **Crítico** abierto pasa su tarjeta a Bloqueada |
| `comercial/pipeline.md` | Embudo |
| `comercial/mercado/oportunidades.json` | Gráfico de oportunidades (brillan desde 8) |
| `comercial/leads.csv` | Mapa con un pin por lead y el contador |
| `comercial/borradores/*.md` | Pulgar arriba cuando el gerente aprueba uno |

## Reglas que se aplican solas

- **Hooks:** nunca bloquean a Claude Code. Corren en segundo plano, con timeout de 1 s, sin salida y siempre terminan con código 0.
- **Secretos:** antes de guardar o mostrar algo se enmascaran tokens, claves, contraseñas, JWT, URLs con credenciales y cadenas de alta entropía. Solo quedan los últimos 4 caracteres.
- **Seguridad** (por `office-guard`, antes de que corra cada herramienta):
  - auditorías solo defensivas: nada de escáneres ofensivos ni pedidos a sistemas externos;
  - AWS solo de lectura y con el perfil indicado;
  - `gitleaks` siempre con `--redact`;
  - no leen `.env`, llaves ni `tfstate`;
  - solo escriben en `docs/security/`.
- **Comercial:**
  - no pueden enviar nada ni completar formularios; en Bash solo pueden usar `office-task`;
  - solo escriben en `comercial/`;
  - cada dato lleva su fuente y fecha de consulta.

## Variables de entorno

| Variable | Default | Para |
|---|---|---|
| `AGENT_OFFICE_PORT` / `AGENT_OFFICE_HOST` | `4317` / `127.0.0.1` | Server |
| `AGENT_OFFICE_DB` | `.data/office.db` | Base SQLite |
| `AGENT_OFFICE_WORKSPACE` | raíz git del cwd de la sesión | Repo del que se leen los archivos |
| `AGENT_OFFICE_URL` | `http://127.0.0.1:4317/events` | A dónde manda eventos el hook |
| `AGENT_OFFICE_API` | `http://127.0.0.1:4317` | A dónde habla `office-task` |
| `AGENT_OFFICE_AWS_PROFILE` | — | Único perfil de AWS permitido para seguridad |

## Desarrollo

```bash
pnpm test        # vitest: server, shared, web, hooks y archivos de agentes
pnpm typecheck
```

- `apps/server`: Fastify, SQLite, WebSocket, watcher del workspace y demo.
- `apps/web`: React, PixiJS y zustand.
- `apps/cli`: `office-task`.
- `packages/shared`: tipos, redactor y parsers.
- `hooks/`: `emit.sh` y `office-guard`.
- `claude/`: agentes, comandos y el bloque de `CLAUDE.md`.
- `scripts/office.ts`: el instalador.

## Si algo no anda

- **No aparece mi sesión:**
  - `pnpm office status` tiene que mostrar 10/10 hooks;
  - la sesión de `claude` tiene que ser posterior a la instalación;
  - `curl localhost:4317/health` tiene que responder.
- **`office-task: command not found`:** agregá `~/.local/bin` al `PATH`.
- **Un agente dice “Bloqueado por las reglas del equipo”:** es la guardia funcionando. El mensaje explica qué regla aplicó.
- **No suena nada:** activá el sonido arriba. El navegador necesita un clic en la página antes de dejar sonar.
