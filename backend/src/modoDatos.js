/**
 * De dónde salen los datos del servidor.
 *
 * "semilla" (por defecto): el servidor no habla con SEACE. SEACE bloquea las
 * IPs de servidores en la nube (Render, GitHub), así que los datos los
 * recolecta la Mac del gerente y los publica como semilla (ver
 * tools/mac/actualizar-desde-mac.sh); el servidor la relee cada rato.
 *
 * "seace" (SYNC_SEACE=1): el servidor sincroniza él mismo con SEACE. Sirve
 * para correr en una conexión que SEACE no bloquee (p. ej. el desarrollo local).
 */
export const sincronizaConSeace = () => process.env.SYNC_SEACE === '1';
export const fuenteDeDatos = () => (sincronizaConSeace() ? 'seace' : 'semilla');
