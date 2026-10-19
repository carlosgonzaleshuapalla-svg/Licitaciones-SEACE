import rateLimit from 'express-rate-limit';

/**
 * Límite general para /api/*: generoso para uso normal (paginar, cambiar
 * filtros dispara varias requests rápidas), pero corta el paso a scraping
 * agresivo o intentos de tumbar el servicio a fuerza de requests.
 */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Espera un momento e intenta de nuevo.' },
});

/**
 * /api/sync es el endpoint más caro: dispara ~1000+ requests salientes a
 * la API de SEACE y reescribe toda la base. Límite mucho más estricto por
 * IP — nadie necesita disparar una sincronización manual más de un par de
 * veces cada 5 minutos (ya corre sola cada 20 min).
 */
export const syncLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 2,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Ya se sincronizó hace poco. Espera unos minutos antes de volver a intentar.' },
});

/**
 * /api/export arma y comprime toda la base (~2500 licitaciones): útil para
 * la tarea que guarda la semilla, pesado si se abusa. Pocas por IP.
 */
export const exportLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas exportaciones. Espera unos minutos.' },
});
