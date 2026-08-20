import { createApp } from './app.js';
import { startScheduledSync } from './syncService.js';

const PORT = process.env.PORT || 4000;

const app = createApp();

app.listen(PORT, () => {
  console.log(`SEACE backend escuchando en http://localhost:${PORT}`);
  startScheduledSync({ log: console.log });
});
