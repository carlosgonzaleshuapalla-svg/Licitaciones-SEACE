import unittest
from datetime import datetime, timedelta, timezone

import avisar_notion as a

LIMA = timezone(timedelta(hours=-5))
AHORA = datetime(2026, 10, 23, 12, 0, tzinfo=LIMA)


def lic(id, objeto="Bien", fin="30/10/2026 17:00:00", ciudad="CUSCO/CUSCO/CUSCO", detalle=True, desc="COMPRA DE CEMENTO", pub="20/10/2026 09:00:00"):
    t = {"id": id, "codigo": f"CM-{id}", "entidad": "MUNI", "objeto": objeto, "descripcion": desc,
         "fechaPublicacion": pub, "cotizacionFin": fin, "detalleOk": 1 if detalle else 0}
    if detalle:
        t["items"] = [{"producto": "CEMENTO PORTLAND", "cantidad": 10, "unidadMedida": "BOLSA", "ciudad": ciudad}]
    return t


class Puras(unittest.TestCase):
    def test_fecha_y_plazo(self):
        self.assertTrue(a.esta_abierta("30/10/2026 17:00:00", AHORA))
        self.assertFalse(a.esta_abierta("22/10/2026 23:59:59", AHORA))
        self.assertTrue(a.esta_abierta(None, AHORA))
        self.assertTrue(a.esta_abierta("raro", AHORA))
        self.assertEqual(a.iso_fecha("30/10/2026 17:00:00"), "2026-10-30T17:00:00-05:00")
        self.assertIsNone(a.iso_fecha("31/02/2026 10:00:00"))

    def test_filtros(self):
        self.assertTrue(a.cumple_filtro(lic(1), ["Bien"], [], []))
        self.assertFalse(a.cumple_filtro(lic(1, objeto="Servicio"), ["Bien"], [], []))
        self.assertTrue(a.cumple_filtro(lic(1), ["Bien"], ["cusco"], []))
        self.assertFalse(a.cumple_filtro(lic(1), ["Bien"], ["Lima"], []))
        self.assertFalse(a.cumple_filtro(lic(1, detalle=False), ["Bien"], ["Cusco"], []), "sin detalle no se sabe la ciudad")
        self.assertTrue(a.cumple_filtro(lic(1, detalle=False), ["Bien"], [], []))
        self.assertTrue(a.cumple_filtro(lic(1), ["Bien"], [], ["cemento"]))
        self.assertTrue(a.cumple_filtro(lic(1, desc="Adquisición de papelería"), ["Bien"], [], ["PAPELERIA"]))
        self.assertFalse(a.cumple_filtro(lic(1), ["Bien"], [], ["laptop"]))

    def test_propiedades(self):
        p = a.propiedades_notion(lic(7))
        self.assertEqual(p["ID SEACE"]["number"], 7)
        self.assertEqual(p["Enlace SEACE"]["url"], "https://prod6.seace.gob.pe/buscador-publico/contrataciones/7")
        self.assertEqual(p["Ciudades"]["multi_select"], [{"name": "CUSCO"}])
        self.assertEqual(p["Fin de cotización"]["date"]["start"], "2026-10-30T17:00:00-05:00")
        self.assertEqual(p["Productos"]["rich_text"][0]["text"]["content"], "CEMENTO PORTLAND (10 BOLSA)")
        largo = a.propiedades_notion(lic(8, desc="x" * 5000))
        self.assertLessEqual(len(largo["Descripción"]["title"][0]["text"]["content"]), 2000)


class Entorno(unittest.TestCase):
    def test_variables_vacias_usan_los_valores_por_defecto(self):
        """GitHub pasa las variables sin crear como "" y el script debe tratarlas como ausentes."""
        import gzip, json, os, subprocess, sys, tempfile
        with tempfile.TemporaryDirectory() as d:
            ruta = os.path.join(d, "s.json.gz")
            with gzip.open(ruta, "wt") as f:
                json.dump({"version": 1, "tenders": [lic(1)]}, f)
            env = {**os.environ, "AVISO_TIPOS": "", "AVISO_CIUDADES": "", "AVISO_PALABRAS": "", "AVISO_MAX_NUEVAS": ""}
            r = subprocess.run([sys.executable, a.__file__, ruta, "--dry-run"], env=env, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("tipos=['Bien']", r.stdout)


class Plan(unittest.TestCase):
    def test_plan(self):
        semilla = {"tenders": [
            lic(1), lic(2), lic(3, objeto="Servicio"),
            lic(4, fin="01/10/2026 10:00:00"),          # ya venció
            lic(5, pub="22/10/2026 09:00:00"),
        ]}
        filas = {2: {"page_id": "p2", "vencida": False},    # ya está en Notion, sigue vigente
                 9: {"page_id": "p9", "vencida": False},    # salió de la lista -> vencida
                 4: {"page_id": "p4", "vencida": True}}     # ya marcada, no se repite
        nuevas, pendientes, vencer = a.planificar(semilla, filas, ["Bien"], [], [], AHORA, 300)
        self.assertEqual([t["id"] for t in nuevas], [5, 1], "lo más reciente primero, sin duplicar ni traer vencidas")
        self.assertEqual(vencer, ["p9"])
        nuevas, pendientes, _ = a.planificar(semilla, filas, ["Bien"], [], [], AHORA, 1)
        self.assertEqual([t["id"] for t in nuevas], [5])
        self.assertEqual(pendientes, 1)

    def test_ejecutar_con_notion_falso(self):
        class Falso:
            def __init__(self):
                self.llamadas = []

            def llamar(self, metodo, ruta, cuerpo=None):
                self.llamadas.append((metodo, ruta, cuerpo))
                if ruta.endswith("/query"):
                    return {"results": [{"id": "p9", "properties": {"ID SEACE": {"number": 9}, "Vencida": {"checkbox": False}}}], "has_more": False}
                return {}

        http = Falso()
        a.ejecutar({"tenders": [lic(1), lic(2)]}, http, "DB", ["Bien"], [], [], AHORA, 300)
        metodos = [(m, r) for m, r, _ in http.llamadas]
        self.assertEqual(metodos.count(("POST", "/pages")), 2)
        self.assertIn(("PATCH", "/pages/p9"), metodos)
        creada = next(c for m, r, c in http.llamadas if r == "/pages")
        self.assertEqual(creada["parent"], {"database_id": "DB"})
        parches = [c for m, r, c in http.llamadas if m == "PATCH"]
        self.assertEqual(parches, [{"properties": {"Vencida": {"checkbox": True}}}], "al vencer solo se toca 'Vencida', nunca el seguimiento")


if __name__ == "__main__":
    unittest.main()
