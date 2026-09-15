#!/usr/bin/env python3
"""Pruebas sin red de los productores de datos (ronda 38, 15/09/2026).

- pvpc_auto_fill.merge_month_file: un dia completo solo lo sustituye otro completo.
- ssaa_auto_fill: el historico publicado se fusiona con la respuesta de ESIOS en vez de
  reescribirse solo con ella.

Uso: python scripts/test_auto_fill.py
Se ejecuta en pvpc.yml antes de descargar y en tests.yml en cada push.
"""

from __future__ import annotations

import contextlib
import datetime as dt
import io
import json
import os
import sys
import tempfile
import unittest
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pvpc_auto_fill as pvpc  # noqa: E402
import ssaa_auto_fill as ssaa  # noqa: E402

TZ = ZoneInfo("Europe/Madrid")
DIA = "2025-10-20"


def dia_horario(puntos=24, precio=0.1):
    inicio = int(dt.datetime(2025, 10, 20, tzinfo=TZ).timestamp())
    return [[inicio + i * 3600, precio] for i in range(puntos)]


def fichero_mes(days):
    return {
        "schema_version": 2, "geo_id": 8741, "timezone": "Europe/Madrid", "indicator": 1001,
        "unit": "EUR/kWh", "epoch_unit": "s", "from": "2025-10-01", "to": "2025-10-31",
        "days": days, "meta": {},
    }


class MergeMonthFile(unittest.TestCase):
    def fusionar(self, viejo, nuevo):
        with tempfile.TemporaryDirectory() as tmp:
            ruta = os.path.join(tmp, "2025-10.json")
            with open(ruta, "w", encoding="utf-8") as f:
                json.dump(fichero_mes({DIA: viejo}), f)
            return pvpc.merge_month_file(ruta, fichero_mes({DIA: nuevo}), TZ)["days"][DIA]

    def test_un_dia_completo_no_lo_sustituye_uno_con_un_duplicado(self):
        bueno = dia_horario()
        roto = [list(punto) for punto in bueno]
        roto[11][0] = roto[10][0]
        self.assertEqual(self.fusionar(bueno, roto), bueno)

    def test_un_dia_completo_no_lo_sustituye_uno_con_un_salto(self):
        bueno = dia_horario()
        roto = [list(punto) for punto in bueno]
        roto[11][0] += 3600
        self.assertEqual(self.fusionar(bueno, roto), bueno)

    def test_un_dia_completo_no_lo_sustituye_uno_mas_corto(self):
        bueno = dia_horario()
        self.assertEqual(self.fusionar(bueno, bueno[:23]), bueno)

    def test_una_rectificacion_completa_si_sustituye_al_dia_publicado(self):
        self.assertEqual(self.fusionar(dia_horario(precio=0.1), dia_horario(precio=0.2)),
                         dia_horario(precio=0.2))

    def test_el_dia_en_curso_crece_hasta_completarse(self):
        self.assertEqual(self.fusionar(dia_horario(10), dia_horario(20)), dia_horario(20))
        self.assertEqual(self.fusionar(dia_horario(20), dia_horario()), dia_horario())

    def test_entre_dos_versiones_incompletas_no_se_encoge(self):
        self.assertEqual(self.fusionar(dia_horario(20), dia_horario(10)), dia_horario(20))


def meses(desde, cuantos, valor=0.02):
    year, month = map(int, desde.split("-"))
    salida = {}
    for _ in range(cuantos):
        salida[f"{year:04d}-{month:02d}"] = valor
        month += 1
        if month == 13:
            month, year = 1, year + 1
    return salida


def respuesta_esios(valores):
    # Forma real de ESIOS para 10328 con time_trunc=month: EUR/MWh y fecha local del mes.
    return {"indicator": {"unit": "€/MWh", "values": [
        {"datetime": f"{ym}-01T00:00:00+01:00", "value": round(valor * 1000, 3)}
        for ym, valor in valores.items()
    ]}}


class SsaaFusion(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.ruta = os.path.join(self.tmp.name, "index.json")
        self.http_original = ssaa.http_get_json

    def tearDown(self):
        ssaa.http_get_json = self.http_original
        self.tmp.cleanup()

    def publicar(self, valores, indicador=10328):
        with open(self.ruta, "w", encoding="utf-8") as f:
            json.dump({"schema_version": 1, "indicator": indicador, "unit": "EUR/kWh",
                       "timezone": "Europe/Madrid", "values": valores}, f)

    def ejecutar(self, respuesta):
        ssaa.http_get_json = lambda url, api_key, timeout_s=60: respuesta
        os.environ["ESIOS_API_KEY"] = "prueba"
        argv = sys.argv
        sys.argv = ["ssaa_auto_fill.py", "--out-file", self.ruta, "--indicator", "10328"]
        try:
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                return ssaa.main()
        finally:
            sys.argv = argv

    def leer(self):
        with open(self.ruta, encoding="utf-8") as f:
            return json.load(f)

    def test_una_respuesta_parcial_no_borra_el_historico(self):
        # El caso confirmado en la ronda 38: 24 meses publicados y un HTTP 200 con uno solo.
        self.publicar(meses("2024-09", 24))
        self.assertEqual(self.ejecutar(respuesta_esios({"2026-08": 0.01883})), 0)
        salida = self.leer()
        self.assertEqual(len(salida["values"]), 24)
        self.assertEqual(salida["from"], "2024-09")
        self.assertEqual(salida["to"], "2026-08")
        self.assertAlmostEqual(salida["values"]["2026-08"], 0.01883, places=6)

    def test_una_rectificacion_sustituye_al_mes_publicado(self):
        self.publicar(meses("2025-01", 12, valor=0.02))
        self.ejecutar(respuesta_esios({"2025-07": 0.015}))
        self.assertAlmostEqual(self.leer()["values"]["2025-07"], 0.015, places=6)

    def test_un_mes_nuevo_se_anade_sin_perder_los_anteriores(self):
        self.publicar(meses("2024-09", 24))
        self.ejecutar(respuesta_esios({"2026-09": 0.021}))
        salida = self.leer()
        self.assertEqual(len(salida["values"]), 25)
        self.assertEqual(salida["from"], "2024-09")
        self.assertEqual(salida["to"], "2026-09")

    def test_sin_fichero_previo_manda_la_respuesta(self):
        self.ejecutar(respuesta_esios(meses("2025-01", 3)))
        self.assertEqual(sorted(self.leer()["values"]), ["2025-01", "2025-02", "2025-03"])

    def test_un_fichero_de_otro_indicador_no_se_fusiona(self):
        self.publicar(meses("2020-01", 12), indicador=999)
        self.ejecutar(respuesta_esios({"2026-08": 0.01883}))
        self.assertEqual(list(self.leer()["values"]), ["2026-08"])

    def test_una_respuesta_vacia_es_un_error_y_no_toca_el_fichero(self):
        self.publicar(meses("2024-09", 24))
        with open(self.ruta, encoding="utf-8") as f:
            antes = f.read()
        self.assertEqual(self.ejecutar({"indicator": {"unit": "€/MWh", "values": []}}), 1)
        with open(self.ruta, encoding="utf-8") as f:
            self.assertEqual(f.read(), antes)


if __name__ == "__main__":
    unittest.main(verbosity=2)
