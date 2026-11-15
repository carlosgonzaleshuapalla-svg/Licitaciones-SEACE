import { createApp } from './app.js';
import { startScheduledSync } from './syncService.js';
import { cargarSemillaSiVacia, iniciarRefrescoDeSemilla } from './semilla.js';
import { sincronizaConSeace } from './modoDatos.js';

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
  // semilla para servir datos completos enseguida. Después, o bien se
  // sincroniza con SEACE (SYNC_SEACE=1), o bien —por defecto— se relee la
  // semilla cada rato: SEACE bloquea las IPs de la nube y los datos los
  // renueva la Mac del gerente (ver modoDatos.js).
  try {
    await cargarSemillaSiVacia({ log: console.log });
  } catch (err) {
    console.error('Falló la carga de la semilla:', err);
  }
  if (sincronizaConSeace()) startScheduledSync({ log: console.log });
  else iniciarRefrescoDeSemilla({ log: console.log });
});
