import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { apiRouter } from './routes/api.js';
import { apiLimiter } from './security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Build del frontend (Vite) copiado a backend/public en el paso de deploy —
// ver backend/package.json script "build". Si no existe (dev local con
// `npm run dev` en frontend/ aparte), el backend simplemente no la sirve.
const FRONTEND_DIST = path.join(__dirname, '..', 'public');

export function createApp() {
  const app = express();

  // Detrás del proxy de Render (y de cualquier host similar) hay que
  // confiar en X-Forwarded-For para que el rate limiting identifique la IP
  // real del cliente en vez de la IP interna del proxy (si no, todo el
  // tráfico parecería venir de una sola IP y el límite no serviría de nada).
  app.set('trust proxy', 1);

  app.use(
    helmet({
      // API de solo lectura sin recursos externos propios más allá de lo
      // que el HTML del frontend ya declara (fonts de Google) — CSP queda
      // a cargo del propio index.html/Vite; acá solo las cabeceras base.
      contentSecurityPolicy: false,
    }),
  );
  app.use(cors()); // habilita un frontend en otro origen (ej. localhost:5173) para consumir la API
  app.use(express.json({ limit: '10kb' })); // esta API no recibe bodies grandes en ningún endpoint real
  app.use('/api', apiLimiter, apiRouter);

  if (fs.existsSync(FRONTEND_DIST)) {
    app.use(express.static(FRONTEND_DIST));
    // SPA fallback: cualquier ruta que no sea /api/* sirve index.html.
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
    });
  }

  // Red de seguridad final: cualquier error no manejado explícitamente
  // (JSON malformado, algo inesperado en una ruta) responde 4xx/5xx
  // genérico en vez de filtrar el stack trace o tumbar el proceso.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') {
      return res.status(400).json({ error: 'Solicitud inválida.' });
    }
    console.error('Error no manejado:', err);
    res.status(500).json({ error: 'Error interno del servidor.' });
  });

  return app;
}
