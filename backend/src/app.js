import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { apiRouter } from './routes/api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Build del frontend (Vite) copiado a backend/public en el paso de deploy —
// ver backend/package.json script "build". Si no existe (dev local con
// `npm run dev` en frontend/ aparte), el backend simplemente no la sirve.
const FRONTEND_DIST = path.join(__dirname, '..', 'public');

export function createApp() {
  const app = express();
  app.use(cors()); // habilita un frontend en otro origen (ej. localhost:5173) para consumir la API
  app.use(express.json());
  app.use('/api', apiRouter);

  if (fs.existsSync(FRONTEND_DIST)) {
    app.use(express.static(FRONTEND_DIST));
    // SPA fallback: cualquier ruta que no sea /api/* sirve index.html.
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
    });
  }

  return app;
}
