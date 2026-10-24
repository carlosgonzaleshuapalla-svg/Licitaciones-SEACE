"""Agrega a una base de Notion las licitaciones vigentes de la semilla.

Solo usa la biblioteca estándar. Lee la semilla ya descargada y validada por el
workflow (no consulta a SEACE), se queda con las que siguen dentro de plazo y
cumplen el filtro, y crea en Notion las que todavía no están (se reconocen por
"ID SEACE"). Nunca modifica el seguimiento de lo ya creado. Cuando una licitación
sale de la lista vigente (venció o SEACE la retiró):
  - si sigue en "Nueva" (nadie le dio seguimiento) se manda a la papelera de
    Notion, donde se puede recuperar durante 30 días;
  - si ya tiene seguimiento (Cotizando, Cotizada, Descartada) se conserva y solo
    se marca "Vencida".

Uso:
  python3 avisar_notion.py semilla.json.gz            # modo real (necesita NOTION_TOKEN)
  python3 avisar_notion.py semilla.json.gz --dry-run   # muestra qué haría, sin red

Variables de entorno:
  NOTION_TOKEN         token de la integración (secreto; nunca se imprime)
  NOTION_DATABASE_ID   id de la base de Notion
  AVISO_TIPOS          "Bien", "Servicio" o "Bien,Servicio" (por defecto Bien)
  AVISO_CIUDADES       departamentos separados por coma (vacío = todos)
  AVISO_PALABRAS       palabras clave separadas por coma (vacío = sin filtro)
  AVISO_MAX_NUEVAS     tope de filas nuevas por corrida (por defecto 300)
"""
import gzip
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

NOTION_API = "https://api.notion.com/v1"
NOTION_VERSION = "2022-06-28"
URL_OFICIAL = "https://prod6.seace.gob.pe/buscador-publico/contrataciones/{}"
LIMA = timezone(timedelta(hours=-5))
TIPOS_VALIDOS = {"Bien", "Servicio"}
MAX_TEXTO = 1900  # Notion corta cada bloque de texto en 2000 caracteres


# ---------- utilidades puras ----------

def sin_acentos(texto):
    t = unicodedata.normalize("NFD", texto or "")
    return "".join(c for c in t if unicodedata.category(c) != "Mn").lower()


def lista_env(valor):
    return [x.strip() for x in (valor or "").split(",") if x.strip()]


def fecha_seace(texto):
    """'DD/MM/YYYY HH:mm:ss' (hora de Lima) -> datetime con zona, o None."""
    m = re.fullmatch(r"(\d{2})/(\d{2})/(\d{4}) (\d{2}):(\d{2}):(\d{2})", (texto or "").strip())
    if not m:
        return None
    d, mes, a, h, mi, s = map(int, m.groups())
    try:
        return datetime(a, mes, d, h, mi, s, tzinfo=LIMA)
    except ValueError:
        return None


def esta_abierta(cotizacion_fin, ahora):
    """Sin fecha o con formato raro cuenta como abierta (igual que el portal)."""
    f = fecha_seace(cotizacion_fin)
    return True if f is None else f >= ahora


def recortar(texto, n=MAX_TEXTO):
    texto = (texto or "").strip()
    return texto if len(texto) <= n else texto[: n - 1] + "…"


def ciudades_de(tender):
    vistas = []
    for it in tender.get("items") or []:
        depto = (it.get("ciudad") or "").split("/")[0].strip()
        if depto and depto not in vistas:
            vistas.append(depto)
    return vistas


def productos_de(tender):
    partes, vistos = [], set()
    for it in tender.get("items") or []:
        nombre = (it.get("producto") or "").strip()
        if not nombre or nombre in vistos:
            continue
        vistos.add(nombre)
        cant = it.get("cantidad")
        extra = ""
        if isinstance(cant, (int, float)):
            cant_txt = int(cant) if float(cant).is_integer() else cant
            extra = f" ({cant_txt} {(it.get('unidadMedida') or '').strip()})".replace(" )", ")")
        partes.append(nombre + extra)
    return recortar("; ".join(partes))


def cumple_filtro(tender, tipos, ciudades, palabras):
    if tipos and tender.get("objeto") not in tipos:
        return False
    if ciudades:
        # sin detalle no se sabe la ciudad: se espera a la próxima corrida
        if not tender.get("detalleOk"):
            return False
        mias = {sin_acentos(c) for c in ciudades_de(tender)}
        if not mias & {sin_acentos(c) for c in ciudades}:
            return False
    if palabras:
        pajar = sin_acentos(f"{tender.get('descripcion', '')} {productos_de(tender)}")
        if not any(sin_acentos(p) in pajar for p in palabras):
            return False
    return True


def iso_fecha(texto):
    f = fecha_seace(texto)
    return f.isoformat() if f else None


def propiedades_notion(tender):
    props = {
        "Descripción": {"title": [{"text": {"content": recortar(tender.get("descripcion")) or "(sin descripción)"}}]},
        "Seguimiento": {"status": {"name": "Nueva"}},
        "Entidad": {"rich_text": [{"text": {"content": recortar(tender.get("entidad"))}}]},
        "Código": {"rich_text": [{"text": {"content": recortar(tender.get("codigo"))}}]},
        "Productos": {"rich_text": [{"text": {"content": productos_de(tender)}}]},
        "Enlace SEACE": {"url": URL_OFICIAL.format(tender["id"])},
        "ID SEACE": {"number": tender["id"]},
        "Vencida": {"checkbox": False},
    }
    if tender.get("objeto") in TIPOS_VALIDOS:
        props["Tipo"] = {"select": {"name": tender["objeto"]}}
    ciudades = ciudades_de(tender)
    if ciudades:
        props["Ciudades"] = {"multi_select": [{"name": c.replace(",", " ")[:100]} for c in ciudades]}
    fin, pub = iso_fecha(tender.get("cotizacionFin")), iso_fecha(tender.get("fechaPublicacion"))
    if fin:
        props["Fin de cotización"] = {"date": {"start": fin}}
    if pub:
        props["Publicada"] = {"date": {"start": pub}}
    return props


SIN_SEGUIMIENTO = "Nueva"


def planificar(semilla, filas_notion, tipos, ciudades, palabras, ahora, max_nuevas):
    """Decide qué crear, qué marcar vencido y qué mandar a la papelera. No hace red.

    filas_notion: {id_seace: {"page_id": str, "vencida": bool, "seguimiento": str|None}}
    Devuelve (nuevas, pendientes_por_tope, a_marcar_vencidas, a_la_papelera).
    """
    abiertas = [t for t in semilla["tenders"] if esta_abierta(t.get("cotizacionFin"), ahora)]
    ids_abiertas = {t["id"] for t in abiertas}
    candidatas = [t for t in abiertas if t["id"] not in filas_notion and cumple_filtro(t, tipos, ciudades, palabras)]
    # lo más reciente primero: si hay tope, lo que queda para la próxima es lo más viejo
    candidatas.sort(key=lambda t: (fecha_seace(t.get("fechaPublicacion")) or datetime.min.replace(tzinfo=LIMA)), reverse=True)
    nuevas = candidatas[:max_nuevas]
    fuera = {i: f for i, f in filas_notion.items() if i not in ids_abiertas}
    papelera = [f["page_id"] for f in fuera.values() if f.get("seguimiento") == SIN_SEGUIMIENTO]
    vencer = [f["page_id"] for f in fuera.values() if f.get("seguimiento") != SIN_SEGUIMIENTO and not f["vencida"]]
    return nuevas, len(candidatas) - len(nuevas), vencer, papelera


# ---------- Notion ----------

class NotionError(Exception):
    pass


class NotionHttp:
    def __init__(self, token, pausa=0.4):
        self.token, self.pausa = token, pausa

    def llamar(self, metodo, ruta, cuerpo=None):
        datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
        for intento in range(5):
            req = urllib.request.Request(
                NOTION_API + ruta,
                data=datos,
                method=metodo,
                headers={
                    "Authorization": f"Bearer {self.token}",
                    "Notion-Version": NOTION_VERSION,
                    "Content-Type": "application/json",
                },
            )
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    time.sleep(self.pausa)  # Notion permite ~3 pedidos por segundo
                    return json.load(r)
            except urllib.error.HTTPError as e:
                detalle = e.read().decode("utf-8", "replace")[:300]
                if e.code == 429 or e.code >= 500:
                    espera = float(e.headers.get("Retry-After") or 2 * (intento + 1))
                    print(f"  Notion respondió {e.code}; reintento en {espera:.0f} s")
                    time.sleep(espera)
                    continue
                raise NotionError(f"{e.code} en {metodo} {ruta}: {detalle}") from None
            except urllib.error.URLError as e:
                if intento == 4:
                    raise NotionError(f"sin conexión con Notion: {e.reason}") from None
                time.sleep(2 * (intento + 1))
        raise NotionError(f"Notion no respondió bien tras varios intentos ({metodo} {ruta})")


def leer_filas_notion(http, db_id):
    filas, cursor = {}, None
    while True:
        cuerpo = {"page_size": 100}
        if cursor:
            cuerpo["start_cursor"] = cursor
        r = http.llamar("POST", f"/databases/{db_id}/query", cuerpo)
        for p in r["results"]:
            if p.get("archived") or p.get("in_trash"):
                continue
            props = p["properties"]
            id_seace = (props.get("ID SEACE") or {}).get("number")
            if id_seace is None:
                continue
            filas[int(id_seace)] = {
                "page_id": p["id"],
                "vencida": bool((props.get("Vencida") or {}).get("checkbox")),
                "seguimiento": ((props.get("Seguimiento") or {}).get("status") or {}).get("name"),
            }
        if not r.get("has_more"):
            return filas
        cursor = r["next_cursor"]


def ejecutar(semilla, http, db_id, tipos, ciudades, palabras, ahora, max_nuevas, dry_run=False):
    filas = {} if dry_run and http is None else leer_filas_notion(http, db_id)
    nuevas, pendientes, vencer, papelera = planificar(semilla, filas, tipos, ciudades, palabras, ahora, max_nuevas)
    print(
        f"En Notion: {len(filas)}. Nuevas a crear: {len(nuevas)} (quedan para la próxima: {pendientes}). "
        f"Vencidas sin seguimiento a la papelera: {len(papelera)}. Vencidas con seguimiento a marcar: {len(vencer)}."
    )
    if dry_run:
        for t in nuevas[:10]:
            print(f"  + [{t.get('objeto')}] {recortar(t.get('descripcion'), 70)} | {', '.join(ciudades_de(t)) or 's/ciudad'} | hasta {t.get('cotizacionFin')}")
        return len(nuevas), len(vencer)
    for page_id in papelera:
        http.llamar("PATCH", f"/pages/{page_id}", {"archived": True})
    for i, t in enumerate(nuevas, 1):
        http.llamar("POST", "/pages", {"parent": {"database_id": db_id}, "properties": propiedades_notion(t)})
        if i % 50 == 0:
            print(f"  creadas {i}/{len(nuevas)}")
    for page_id in vencer:
        http.llamar("PATCH", f"/pages/{page_id}", {"properties": {"Vencida": {"checkbox": True}}})
    print("Listo.")
    return len(nuevas), len(vencer)


def main(argv):
    dry_run = "--dry-run" in argv
    rutas = [a for a in argv[1:] if not a.startswith("--")]
    if not rutas:
        print(__doc__)
        return 2
    with gzip.open(rutas[0], "rb") as f:
        semilla = json.load(f)
    if semilla.get("version") != 1 or not isinstance(semilla.get("tenders"), list):
        print("La semilla no tiene el formato esperado; no se hace nada.")
        return 1

    # GitHub entrega las variables no creadas como texto vacío, no como ausentes.
    tipos = [t for t in lista_env(os.environ.get("AVISO_TIPOS") or "Bien") if t in TIPOS_VALIDOS]
    if not tipos:
        print("AVISO_TIPOS no tiene ningún valor válido (Bien o Servicio).")
        return 1
    ciudades = lista_env(os.environ.get("AVISO_CIUDADES"))
    palabras = lista_env(os.environ.get("AVISO_PALABRAS"))
    max_nuevas = int(os.environ.get("AVISO_MAX_NUEVAS") or 300)
    ahora = datetime.now(LIMA)
    print(f"Filtro: tipos={tipos} ciudades={ciudades or 'todas'} palabras={palabras or 'sin filtro'}")

    if dry_run:
        ejecutar(semilla, None, None, tipos, ciudades, palabras, ahora, max_nuevas, dry_run=True)
        return 0

    token, db_id = os.environ.get("NOTION_TOKEN", ""), os.environ.get("NOTION_DATABASE_ID", "")
    if not token or not db_id:
        print("Falta NOTION_TOKEN o NOTION_DATABASE_ID.")
        return 1
    try:
        ejecutar(semilla, NotionHttp(token), db_id, tipos, ciudades, palabras, ahora, max_nuevas)
    except NotionError as e:
        print(f"Error de Notion: {e}")
        if str(e).startswith(("401", "404")):
            print("Revisa que el token sea válido y que la base esté compartida con la integración (••• > Conexiones).")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
