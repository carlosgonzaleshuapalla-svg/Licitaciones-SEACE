"""Espera a que el servidor de Render (recién despertado o ya activo) tenga datos
frescos y completos, consultando /api/status. Sale con 0 si está listo para
exportar y con 10 si se acabó el tiempo sin estarlo (no es un error: simplemente
no se publica una semilla a medias)."""
import json
import sys
import time
import urllib.request
from datetime import datetime, timezone

URL = sys.argv[1].rstrip("/")
LIMITE_S = 30 * 60
MAX_EDAD_EXITO_S = 60 * 60  # la última lista completa debe tener menos de 1 h
MAX_PENDIENTES = 0.03  # a lo sumo 3 % de licitaciones sin detalle


def estado():
    with urllib.request.urlopen(f"{URL}/api/status", timeout=90) as r:
        return json.load(r)


def edad_s(iso):
    if not iso:
        return None
    t = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return (datetime.now(timezone.utc) - t).total_seconds()


inicio = time.time()
while time.time() - inicio < LIMITE_S:
    try:
        s = estado()
        total = s.get("total", 0)
        pend = s.get("pendientesDetalle", 0)
        edad = edad_s(s.get("ultimoExito"))
        print(
            f"total={total} pendientes={pend} sincronizando={s.get('sincronizando')} "
            f"bloqueado={s.get('bloqueado')} ultimoExito_hace_s={None if edad is None else int(edad)}",
            flush=True,
        )
        if total >= 100 and edad is not None and edad <= MAX_EDAD_EXITO_S and pend <= total * MAX_PENDIENTES:
            print("Listo: datos frescos y completos.")
            sys.exit(0)
    except Exception as e:  # el servidor puede estar arrancando en frío
        print(f"(sin respuesta todavía: {e})", flush=True)
    time.sleep(30)

print("Se acabó el tiempo sin datos frescos y completos.")
sys.exit(10)
