import { fileURLToPath } from 'node:url';
import { buildApp } from './app.ts';

const PORT = Number(process.env.AGENT_OFFICE_PORT ?? 4317);
const HOST = process.env.AGENT_OFFICE_HOST ?? '127.0.0.1';
const DB_FILE = process.env.AGENT_OFFICE_DB ?? fileURLToPath(new URL('../../../.data/office.db', import.meta.url));

const app = await buildApp({ dbFile: DB_FILE, logger: { level: process.env.LOG_LEVEL ?? 'warn' } });
await app.listen({ port: PORT, host: HOST });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
