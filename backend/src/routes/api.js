import { Router } from 'express';
import { listarTenders, obtenerTenderDetalle, obtenerMeta } from '../tendersRepo.js';
import { runSync, getSyncStatus } from '../syncService.js';
import { syncLimiter, exportLimiter } from '../security.js';
import { exportarSemilla, comprimirSemilla, infoSemilla } from '../semilla.js';

export const apiRouter = Router();

apiRouter.get('/health', (req, res) => {
  res.json({ ok: true });
});

apiRouter.get('/meta', (req, res) => {
  res.json(obtenerMeta());
});

apiRouter.get('/tenders', (req, res) => {
  const { departamento, estado, q, objeto, ocultarVencidas, page, pageSize } = req.query;
  const resultado = listarTenders({
    departamento: departamento || undefined,
    estado: estado || undefined,
    q: q || undefined,
    objeto: objeto || undefined,
    ocultarVencidas: ocultarVencidas === 'true' || ocultarVencidas === '1',
    page: page ? Number(page) : 1,
    pageSize: pageSize ? Number(pageSize) : 20,
  });
  res.json(resultado);
});

apiRouter.get('/tenders/:id', (req, res) => {
  const idContrato = Number(req.params.id);
  if (!Number.isInteger(idContrato)) {
    return res.status(400).json({ error: 'id inválido' });
  }
  const detalle = obtenerTenderDetalle(idContrato);
  if (!detalle) {
    return res.status(404).json({ error: 'no encontrado' });
  }
  res.json(detalle);
});

// Estado de la sincronización y qué tan completos están los datos (cuántas
// licitaciones ya tienen su detalle descargado). Lo usa el frontend para
// avisar cuando lo que se ve es parcial.
apiRouter.get('/status', (req, res) => {
  res.json({ ...getSyncStatus(), semilla: infoSemilla() });
});

// Foto comprimida de toda la base (la "semilla"). Con ella un servidor recién
// despertado (disco vacío) arranca con los datos listos en segundos en vez de
// bajar todo de SEACE otra vez. Ver semilla.js. Son datos públicos de SEACE.
apiRouter.get('/export', exportLimiter, (req, res) => {
  const semilla = exportarSemilla({ sincronizadoEn: getSyncStatus().ultimoExito });
  res.set({
    'Content-Type': 'application/gzip',
    'Content-Disposition': 'attachment; filename="seed.json.gz"',
    'Cache-Control': 'no-store',
  });
  res.send(comprimirSemilla(semilla));
});

// La sincronización puede tardar varios minutos (descarga detalles de a poco
// para no saturar a SEACE), demasiado para dejar la petición abierta. Se
// dispara en segundo plano y se responde enseguida; el avance se consulta
// en /api/status. Los rechazos inmediatos (ya en curso, cooldown, SEACE
// bloqueando) sí se devuelven tal cual.
apiRouter.post('/sync', syncLimiter, async (req, res) => {
  const corrida = runSync({ log: console.log, origen: 'manual' });
  corrida.catch(() => {}); // runSync ya atrapa sus errores; por si acaso
  const rechazoInmediato = await Promise.race([
    corrida,
    new Promise((resolve) => setTimeout(() => resolve(null), 50)),
  ]);
  if (rechazoInmediato) return res.json(rechazoInmediato);
  res.status(202).json({ ok: true, iniciado: true, timestamp: new Date().toISOString() });
});
