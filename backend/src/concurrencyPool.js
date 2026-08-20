/**
 * Ejecuta `tasks` (funciones que devuelven una Promise) con un límite de
 * concurrencia simple, sin dependencias externas. Un fallo individual no
 * detiene al resto: se captura y se reporta vía `onError`.
 */
export async function runWithConcurrency(items, limit, worker, onError) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runNext() {
    while (cursor < items.length) {
      const idx = cursor++;
      try {
        results[idx] = await worker(items[idx], idx);
      } catch (err) {
        if (onError) onError(err, items[idx], idx);
        results[idx] = undefined;
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, runNext);
  await Promise.all(workers);
  return results;
}
