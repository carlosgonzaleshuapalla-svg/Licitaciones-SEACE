import { createApp } from './app.js';
import { startScheduledSync } from './syncService.js';

const PORT = process.env.PORT || 4000;

// Una promesa rechazada sin catch en algún punto no debería tumbar todo el
// proceso en silencio — se loguea y sigue vivo (runSync ya atrapa sus
// propios errores, esto es una red de seguridad extra ante lo inesperado).
process.on('unhandledRejection', (err) => {
  console.error('Promesa rechazada sin manejar:', err);
});

const app = createApp();

app.listen(PORT, () => {
  console.log(`SEACE backend escuchando en http://localhost:${PORT}`);
  startScheduledSync({ log: console.log });
});
