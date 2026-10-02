import app from './app.js';
import { attachStreamWebSocketServer } from './wsStreams.js';

const port = Number(process.env.PORT ?? 3000);
const httpServer = app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

// Attach WebSocket server for real-time stream events.
// Handles: ws://<host>/api/ws/streams/:recipient
attachStreamWebSocketServer(httpServer);
