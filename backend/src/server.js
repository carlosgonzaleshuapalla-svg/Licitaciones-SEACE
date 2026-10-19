import { createApp } from './app.js';
import { startScheduledSync } from './syncService.js';
import { cargarSemillaSiVacia } from './semilla.js';

const PORT = process.env.PORT || 4000;

// Una promesa rechazada sin catch en algún punto no debería tumbar todo el
// proceso en silencio — se loguea y sigue vivo (runSync ya atrapa sus
// propios errores, esto es una red de seguridad extra ante lo inesperado).
process.on('unhandledRejection', (err) => {
  console.error('Promesa rechazada sin manejar:', err);
});

const app = createApp();

app.listen(PORT, async () => {
  console.log(`SEACE backend escuchando en http://localhost:${PORT}`);
  // Con el disco vacío (arranque en frío en Render) primero se carga la
  // semilla para servir datos completos enseguida; recién después se
  // sincroniza con SEACE, que solo pedirá lo que haya cambiado.
  try {
    await cargarSemillaSiVacia({ log: console.log });
  } catch (err) {
    console.error('Falló la carga de la semilla:', err);
  }
  startScheduledSync({ log: console.log });
});
