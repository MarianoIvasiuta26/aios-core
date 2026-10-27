import { COLUMN_LABELS, isOpen, WORKSPACE_FILES, type WorkspaceState } from '@office/shared';
import { useOffice } from '../lib/store.ts';
import { HOT_SCORE } from './zones.ts';

/** Lo que dicen los archivos del repo para una zona (el mismo dato que dibuja la oficina). */
export function ZoneFiles({ zone }: { zone: string }) {
  const ws = useOffice((s) => s.workspace);
  if (!['producto', 'qa', 'soc', 'comercial'].includes(zone)) return null;
  if (!ws) return null;
  const errors = ws.errors.filter((e) => FILES_BY_ZONE[zone]!.some((f) => e.startsWith(f)));
  return (
    <>
      {zone === 'producto' && <Backlog ws={ws} />}
      {zone === 'qa' && <Qa ws={ws} />}
      {zone === 'soc' && <Soc ws={ws} />}
      {zone === 'comercial' && <Comercial ws={ws} />}
      {errors.length > 0 && (
        <section>
          <h3>Archivos con problemas</h3>
          <ul className="plain">
            {errors.map((e) => (
              <li key={e} className="file-error">
                {e}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

const F = WORKSPACE_FILES;
const FILES_BY_ZONE: Record<string, string[]> = {
  producto: [F.backlog],
  qa: [F.qaDir],
  soc: [F.findings],
  comercial: [F.opportunities, F.leads, F.pipeline, F.draftsDir],
};

function Missing({ file }: { file: string }) {
  return (
    <p className="muted">
      Todavía no existe <code>{file}</code>.
    </p>
  );
}

function Backlog({ ws }: { ws: WorkspaceState }) {
  const stories = ws.backlog?.flatMap((e) => e.stories) ?? [];
  const open = stories.filter((s) => s.column !== 'hecha');
  return (
    <section>
      <h3>Backlog</h3>
      {!ws.backlog ? (
        <Missing file={F.backlog} />
      ) : (
        <>
          <p className="muted panel-sub">
            {ws.backlog.length} épicas · {open.length} historias abiertas · {stories.length - open.length} hechas
          </p>
          <ul className="plain">
            {open.slice(0, 8).map((s) => (
              <li key={s.id} className="file-row">
                <span className="file-id">{s.id}</span>
                <span className="file-title">{s.title}</span>
                <span className="muted">
                  {s.priority ?? ''} {s.column ? COLUMN_LABELS[s.column] : ''}
                </span>
              </li>
            ))}
          </ul>
          {open.length > 8 && <p className="muted more">y {open.length - 8} más</p>}
        </>
      )}
    </section>
  );
}

function Qa({ ws }: { ws: WorkspaceState }) {
  const qa = ws.qa;
  return (
    <section>
      <h3>Último reporte</h3>
      {!qa ? (
        <Missing file={`${F.qaDir}/REPORTE-<fecha>.md`} />
      ) : (
        <>
          <p className="panel-sub">
            <span className={`qa-result qa-${qa.result ?? 'none'}`}>{qa.result ?? 'sin resultado'}</span>{' '}
            <span className="muted">{qa.file}</span>
          </p>
          <dl className="stats">
            <div>
              <dt>Pasan</dt>
              <dd>{qa.passed ?? '–'}</dd>
            </div>
            <div>
              <dt>Fallan</dt>
              <dd className={qa.failed ? 'bad' : ''}>{qa.failed ?? '–'}</dd>
            </div>
            <div>
              <dt>Omitidos</dt>
              <dd>{qa.skipped ?? '–'}</dd>
            </div>
            <div>
              <dt>Cobertura</dt>
              <dd>{qa.coverage === null ? '–' : `${qa.coverage}%`}</dd>
            </div>
          </dl>
        </>
      )}
    </section>
  );
}

function Soc({ ws }: { ws: WorkspaceState }) {
  const f = ws.findings;
  const open = f?.findings.filter(isOpen) ?? [];
  return (
    <section>
      <h3>Hallazgos abiertos</h3>
      {!f ? (
        <Missing file={F.findings} />
      ) : open.length === 0 ? (
        <p className="muted">No hay hallazgos abiertos.</p>
      ) : (
        <ul className="plain">
          {open.slice(0, 10).map((x) => (
            <li key={x.id} className="file-row">
              <span className={`sev sev-${x.severity === 'Crítica' ? 'critica' : x.severity.toLowerCase()}`}>{x.severity}</span>
              <span className="file-title" title={x.component ?? undefined}>
                {x.id} · {x.title}
              </span>
              <span className="muted">{x.task ?? ''}</span>
            </li>
          ))}
        </ul>
      )}
      {open.length > 10 && <p className="muted more">y {open.length - 10} más</p>}
    </section>
  );
}

function Comercial({ ws }: { ws: WorkspaceState }) {
  const ops = [...(ws.opportunities ?? [])].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const leads = ws.leads ?? [];
  const pending = ws.drafts.filter((d) => d.status === 'borrador').length;
  return (
    <>
      <section>
        <h3>Oportunidades</h3>
        {!ws.opportunities ? (
          <Missing file={F.opportunities} />
        ) : (
          <ul className="plain">
            {ops.slice(0, 5).map((o) => (
              <li key={o.id} className="file-row">
                <span className={`score ${o.score !== null && o.score >= HOT_SCORE ? 'hot' : ''}`}>{o.score ?? '–'}</span>
                <span className="file-title">{o.opportunity}</span>
                <span className="muted">{o.segment ?? ''}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3>Prospección</h3>
        <dl className="stats cols-3">
          <div>
            <dt>Leads</dt>
            <dd>{leads.filter((l) => l.status !== 'descartado').length}</dd>
          </div>
          <div>
            <dt>Contactados</dt>
            <dd>{leads.filter((l) => l.status === 'contactado').length}</dd>
          </div>
          <div>
            <dt>Borradores a revisar</dt>
            <dd>{pending}</dd>
          </div>
        </dl>
        {ws.pipeline && (
          <p className="muted more">
            Pipeline:{' '}
            {Object.entries(ws.pipeline)
              .map(([stage, items]) => `${stage} ${items.length}`)
              .join(' · ')}
          </p>
        )}
      </section>
    </>
  );
}
