#!/usr/bin/env python3
"""Guardia de frescura de los datasets de datos.

Falla (exit 1) si el dato mas reciente de cualquier dataset supera su umbral
de antiguedad. Pensado para ejecutarse en el workflow diario (pvpc.yml) justo
despues de la descarga: convierte en fallo ruidoso el caso en que ESIOS
responde sin error pero sin datos nuevos (API caida, clave caducada, cambio
de formato), que de otro modo dejaria el workflow en verde con datos rancios.

Umbrales:
- PVPC (diario, se publica manana por la tarde): ultimo dia >= hoy - 1
- Excedentes (diario): ultimo dia >= hoy - 2
- SSAA (mensual, con retraso de publicacion): mes 'to' >= mes actual - 2

Uso:
  python scripts/check_data_freshness.py               # chequeo contra data/
  python scripts/check_data_freshness.py --root DIR    # otra raiz (fixtures)
  python scripts/check_data_freshness.py --self-test   # valida el propio guard
"""

import argparse
import json
import sys
import tempfile
from datetime import date, datetime, timedelta
from pathlib import Path

DEFAULT_ROOT = Path(__file__).resolve().parent.parent
GEOS = ["8741", "8742", "8743", "8744", "8745"]

PVPC_MAX_LAG_DAYS = 1
SURPLUS_MAX_LAG_DAYS = 2
SSAA_MAX_LAG_MONTHS = 2


def today_madrid():
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("Europe/Madrid")).date()
    except Exception:
        # Sin base de datos de zonas horarias (p.ej. Windows sin tzdata):
        # UTC difiere de Madrid en 1-2h, irrelevante con umbrales de dias.
        return datetime.utcnow().date()


def latest_day_in_dataset(base_dir, geo):
    """Devuelve la fecha (date) mas reciente con datos en data/<dataset>/<geo>/."""
    geo_dir = base_dir / geo
    month_files = sorted(p for p in geo_dir.glob("[0-9][0-9][0-9][0-9]-[0-9][0-9].json"))
    if not month_files:
        return None
    with open(month_files[-1], encoding="utf-8") as fh:
        data = json.load(fh)
    days = data.get("days") or {}
    if not days:
        return None
    return date.fromisoformat(max(days.keys()))


def months_ago(base_day, months):
    """Primer dia del mes situado `months` meses antes del mes de base_day."""
    year = base_day.year
    month = base_day.month - months
    while month < 1:
        month += 12
        year -= 1
    return date(year, month, 1)


def run_checks(root, geos=GEOS, hoy=None):
    """Ejecuta todos los chequeos. Devuelve (oks, errores) como listas de texto."""
    hoy = hoy or today_madrid()
    oks = []
    errores = []

    for dataset, max_lag in (("pvpc", PVPC_MAX_LAG_DAYS), ("surplus", SURPLUS_MAX_LAG_DAYS)):
        base_dir = Path(root) / "data" / dataset
        minimo = hoy - timedelta(days=max_lag)
        for geo in geos:
            try:
                ultimo = latest_day_in_dataset(base_dir, geo)
            except Exception as exc:
                errores.append(f"{dataset}/{geo}: error leyendo dataset ({exc})")
                continue
            if ultimo is None:
                errores.append(f"{dataset}/{geo}: sin datos")
            elif ultimo < minimo:
                errores.append(
                    f"{dataset}/{geo}: ultimo dia {ultimo} (umbral {minimo}, hoy {hoy})"
                )
            else:
                oks.append(f"{dataset}/{geo}: ultimo dia {ultimo}")

    ssaa_path = Path(root) / "data" / "ssaa" / "index.json"
    try:
        with open(ssaa_path, encoding="utf-8") as fh:
            ssaa = json.load(fh)
        to_str = str(ssaa.get("to") or "")
        ssaa_to = date.fromisoformat(to_str + "-01")
        minimo_mes = months_ago(hoy, SSAA_MAX_LAG_MONTHS)
        if ssaa_to < minimo_mes:
            errores.append(
                f"ssaa: ultimo mes {to_str} (umbral {minimo_mes.strftime('%Y-%m')}, hoy {hoy})"
            )
        else:
            oks.append(f"ssaa: ultimo mes {to_str}")
    except Exception as exc:
        errores.append(f"ssaa: error leyendo index.json ({exc})")

    return oks, errores


# ---------------------------------------------------------------------------
# Self-test: valida el propio guard con fixtures sinteticos en un tmpdir.
# ---------------------------------------------------------------------------

def _write_month(root, dataset, geo, day_iso):
    """Crea data/<dataset>/<geo>/<YYYY-MM>.json con un unico dia con datos."""
    d = date.fromisoformat(day_iso)
    geo_dir = Path(root) / "data" / dataset / geo
    geo_dir.mkdir(parents=True, exist_ok=True)
    payload = {"days": {day_iso: [[0, 0.1]]}}
    with open(geo_dir / f"{d.strftime('%Y-%m')}.json", "w", encoding="utf-8") as fh:
        json.dump(payload, fh)


def _write_ssaa(root, to_ym):
    ssaa_dir = Path(root) / "data" / "ssaa"
    ssaa_dir.mkdir(parents=True, exist_ok=True)
    with open(ssaa_dir / "index.json", "w", encoding="utf-8") as fh:
        json.dump({"to": to_ym, "values": {to_ym: 0.001}}, fh)


def self_test():
    hoy = today_madrid()
    fallos = []

    def check(nombre, esperado_errores, montar):
        with tempfile.TemporaryDirectory() as tmp:
            montar(tmp)
            _, errores = run_checks(tmp, geos=["8741"], hoy=hoy)
            patrones_no_vistos = [
                pat for pat in esperado_errores
                if not any(pat in err for err in errores)
            ]
            inesperados = len(errores) != len(esperado_errores)
            if patrones_no_vistos or inesperados:
                fallos.append(f"{nombre}: esperaba {esperado_errores}, obtuve {errores}")
                print(f"FAIL {nombre}")
            else:
                print(f"PASS {nombre}")

    def base_fresca(tmp):
        _write_month(tmp, "pvpc", "8741", hoy.isoformat())
        _write_month(tmp, "surplus", "8741", hoy.isoformat())
        _write_ssaa(tmp, hoy.strftime("%Y-%m"))

    # 1. Todo fresco: cero errores
    check("datos frescos", [], base_fresca)

    # 2. PVPC caducado (10 dias): detectado, el resto fresco
    def pvpc_rancio(tmp):
        base_fresca(tmp)
        _write_month(tmp, "pvpc", "8741", (hoy - timedelta(days=10)).isoformat())
        # borrar el mes fresco para que el rancio sea el mas reciente
        for f in (Path(tmp) / "data" / "pvpc" / "8741").glob("*.json"):
            if f.stem == hoy.strftime("%Y-%m") and f.stem != (hoy - timedelta(days=10)).strftime("%Y-%m"):
                f.unlink()
    check("pvpc caducado", ["pvpc/8741: ultimo dia"], pvpc_rancio)

    # 3. Directorio de geo vacio: 'sin datos'
    def surplus_vacio(tmp):
        base_fresca(tmp)
        for f in (Path(tmp) / "data" / "surplus" / "8741").glob("*.json"):
            f.unlink()
    check("directorio vacio", ["surplus/8741: sin datos"], surplus_vacio)

    # 4. JSON invalido: 'error leyendo'
    def pvpc_corrupto(tmp):
        base_fresca(tmp)
        for f in (Path(tmp) / "data" / "pvpc" / "8741").glob("*.json"):
            f.write_text("{esto no es json", encoding="utf-8")
    check("json invalido", ["pvpc/8741: error leyendo"], pvpc_corrupto)

    # 5. Mes con 'days' vacio: 'sin datos'
    def pvpc_sin_dias(tmp):
        base_fresca(tmp)
        for f in (Path(tmp) / "data" / "pvpc" / "8741").glob("*.json"):
            f.write_text(json.dumps({"days": {}}), encoding="utf-8")
    check("days vacio", ["pvpc/8741: sin datos"], pvpc_sin_dias)

    # 6. SSAA caducado (4 meses): detectado
    def ssaa_rancio(tmp):
        base_fresca(tmp)
        _write_ssaa(tmp, months_ago(hoy, 4).strftime("%Y-%m"))
    check("ssaa caducado", ["ssaa: ultimo mes"], ssaa_rancio)

    # 7. SSAA ausente: 'error leyendo'
    def ssaa_ausente(tmp):
        base_fresca(tmp)
        (Path(tmp) / "data" / "ssaa" / "index.json").unlink()
    check("ssaa ausente", ["ssaa: error leyendo"], ssaa_ausente)

    if fallos:
        print("\nSELF-TEST FALLIDO:", file=sys.stderr)
        for f in fallos:
            print(f"  - {f}", file=sys.stderr)
        return 1
    print("\nSelf-test OK (7/7).")
    return 0


def main():
    parser = argparse.ArgumentParser(description="Guardia de frescura de datasets")
    parser.add_argument("--root", default=str(DEFAULT_ROOT), help="raiz del repo (o fixtures)")
    parser.add_argument("--self-test", action="store_true", help="valida el guard con fixtures sinteticos")
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    oks, errores = run_checks(args.root)
    for ok in oks:
        print(f"OK  {ok}")
    if errores:
        print("\nDATOS RANCIOS O ILEGIBLES:", file=sys.stderr)
        for err in errores:
            print(f"  - {err}", file=sys.stderr)
        return 1
    print("\nTodos los datasets estan frescos.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
