# Frontend — Portal de Licitaciones SEACE

Interfaz web para explorar contrataciones vigentes de bienes del Estado
peruano (SEACE), filtrarlas, ver el detalle de cada proceso con sus items y
proveedores sugeridos, y proyectar el precio de venta con una calculadora de
margen. Construido con React + Vite + TypeScript, sin librería de
componentes pesada.

## Requisitos

- Node.js 18+
- El backend corriendo en `http://localhost:4000` (ver `../backend`). Si el
  backend no está disponible, la app igual carga y muestra un mensaje de
  error claro en vez de pantalla en blanco.

## Cómo correrlo

```bash
npm install
npm run dev
```

La app queda disponible en `http://localhost:5173` (puerto por defecto de
Vite) y consume la API en `http://localhost:4000` según el contrato
congelado en `../LEDGER.md`.

Si el backend corre en otra URL, copia `.env.example` a `.env` y ajusta
`VITE_API_BASE_URL`.

## Scripts

- `npm run dev` — servidor de desarrollo (puerto 5173).
- `npm run build` — build de producción (`tsc -b && vite build`).
- `npm run preview` — sirve el build de producción localmente.
- `npm test` — corre los tests con Vitest + React Testing Library.
- `npm run lint` — lint con oxlint.

## Estructura

```
src/
  api/client.ts          # cliente fetch tipado hacia el backend, con manejo de errores
  components/             # UI: filtros, tarjetas, lista, paginación, detalle, calculadora
  lib/margen.ts           # lógica pura de la calculadora de proyección (testeada aislada)
  lib/fechas.ts           # formateo de fechas
  types/api.ts            # tipos derivados del contrato de API
  test/                   # setup de Vitest y datos mockeados para tests
```

## Notas de producto

- El checkbox "Solo productos que se pueden comprar y entregar (Bienes)"
  refleja el criterio real disponible en la fuente (`idObjetoContrato = 1`,
  "Bien"): SEACE no expone un plazo de entrega estructurado, así que la UI
  no promete "rapidez de entrega", solo el tipo de contratación.
- La calculadora de margen es 100% lógica de frontend (sin roundtrip al
  backend por cada movimiento del slider) y se calcula por item, ya que cada
  item de una licitación puede tener un costo unitario distinto.
- Los enlaces de proveedores por item vienen ya calculados desde el backend
  (`proveedores: {nombre, url, categoria}[]`) y se abren en pestaña nueva
  con `target="_blank" rel="noopener noreferrer"`.
