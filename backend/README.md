# SEACE Licitaciones — Backend

API + ETL que sincroniza periódicamente las contrataciones "Bien + Vigente"
del Buscador Público de SEACE (prod6.seace.gob.pe) en una base SQLite local
y las expone vía REST para el frontend.

## Cómo correrlo

```bash
npm install
npm start
```

El servidor queda escuchando en `http://localhost:4000`. Al arrancar dispara
una sincronización inmediata (en segundo plano, no bloquea el arranque del
servidor) y luego repite cada 20 minutos. La base SQLite se crea en
`data/seace.db` (ignorada por git).

## Tests

```bash
npm test
```

Usa `node --test`. Los tests de mapeo del ETL usan fixtures locales
(`test/fixtures/*.json`, capturados de respuestas reales) en vez de pegarle
a la red de SEACE.

## Endpoints

- `GET /api/health` → `{ ok: true }`
- `GET /api/meta` → `{ departamentos: string[], estados: string[] }`
- `GET /api/tenders?departamento=&estado=&q=&soloBienes=&page=&pageSize=`
- `GET /api/tenders/:id` → detalle con items, etapas y enlaces de proveedores
- `POST /api/sync` → dispara una sincronización manual y espera a que
  termine antes de responder (puede tardar varios minutos si hay que traer
  el detalle de los ~1000+ contratos vigentes)
