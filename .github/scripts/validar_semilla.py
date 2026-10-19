"""Valida la semilla descargada antes de publicarla. Sale con 0 si es válida y
completa; con 1 si no lo es (así nunca reemplazamos una buena por una mala)."""
import gzip
import json
import sys

try:
    with gzip.open(sys.argv[1], "rb") as f:
        s = json.load(f)
except Exception as e:
    print(f"No se pudo leer la semilla: {e}")
    sys.exit(1)

total, con_detalle = s.get("total", 0), s.get("conDetalle", 0)
print(f"version={s.get('version')} total={total} conDetalle={con_detalle} sincronizadoEn={s.get('sincronizadoEn')}")
problemas = []
if s.get("version") != 1:
    problemas.append("versión inesperada")
if not isinstance(s.get("tenders"), list) or len(s["tenders"]) != total:
    problemas.append("la lista de licitaciones no coincide con el total")
if total < 1000:
    problemas.append("muy pocas licitaciones (<1000)")
if total and con_detalle / total < 0.97:
    problemas.append("menos del 97 % con detalle")
if not s.get("sincronizadoEn"):
    problemas.append("sin marca de sincronización reciente")
if problemas:
    print("NO se publica:", "; ".join(problemas))
    sys.exit(1)
print("Semilla válida.")
