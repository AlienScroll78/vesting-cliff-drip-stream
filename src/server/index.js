import { createApp } from './app.js';
import { ShutdownManager } from './shutdown.js';

const PORT = process.env.PORT || 3000;

export const shutdownManager = new ShutdownManager();

const app = createApp({
  inFlightMiddleware: shutdownManager.getInFlightMiddleware()
});

const server = app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

shutdownManager.registerSignalHandlers(server);

export { server, app };
