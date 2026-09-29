import app from './app.js';
import { runMigrations } from './migrate.js';

const port = Number(process.env.PORT ?? 3000);

try {
  await runMigrations();
  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
} catch (error) {
  console.error('[startup] database migrations failed', error);
  process.exit(1);
}
