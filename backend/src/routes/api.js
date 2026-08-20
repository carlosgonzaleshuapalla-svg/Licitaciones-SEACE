import { Router } from 'express';
import { listarTenders, obtenerTenderDetalle, obtenerMeta } from '../tendersRepo.js';
import { runSync } from '../syncService.js';

export const apiRouter = Router();

apiRouter.get('/health', (req, res) => {
  res.json({ ok: true });
});

apiRouter.get('/meta', (req, res) => {
  res.json(obtenerMeta());
});

apiRouter.get('/tenders', (req, res) => {
  const { departamento, estado, q, soloBienes, ocultarVencidas, page, pageSize } = req.query;
  const resultado = listarTenders({
    departamento: departamento || undefined,
    estado: estado || undefined,
    q: q || undefined,
    soloBienes: soloBienes === 'true' || soloBienes === '1',
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

apiRouter.post('/sync', async (req, res) => {
  const resultado = await runSync({ log: console.log });
  res.json(resultado);
});
