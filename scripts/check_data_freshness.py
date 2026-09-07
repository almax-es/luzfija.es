#!/usr/bin/env python3
"""Guardia de frescura e integridad temporal de los datasets de datos.

Falla (exit 1) si el dato mas reciente de cualquier dataset supera su umbral
de antiguedad, si falta un dia intermedio o si una serie diaria ya cerrada esta
incompleta/malformada.
Pensado para ejecutarse en el workflow diario (pvpc.yml) justo despues de la
descarga: convierte en fallo ruidoso el caso en que ESIOS responde sin error
pero sin datos nuevos (API caida, clave caducada, cambio de formato), o deja
un dia historico con puntos horarios ausentes.

Regla de integridad diaria (PVPC y excedentes):
- no puede faltar ningun dia intermedio entre el primero y el ultimo publicado.
- dia anterior al dia local vigente de la zona del fichero: debe estar completo
  (23/24/25 puntos en cambios DST, normalmente 24) y ser horario continuo.
- dia >= hoy: puede estar parcial porque ESIOS puede estar publicando el dia
  vigente o futuro; aun asi, no puede exceder el numero esperado ni contener
  saltos/duplicados o timestamps que pertenezcan a otro dia local.

Umbrales de frescura:
- PVPC (diario, se publica manana por la tarde): ultimo dia con datos >= hoy - 1
- Excedentes (diario): ultimo dia con datos >= hoy - 2
- SSAA (mensual, con retraso de publicacion): mes 'to' >= mes actual - 2

Uso:
  python scripts/check_data_freshness.py               # chequeo contra data/
  python scripts/check_data_freshness.py --root DIR    # otra raiz (fixtures)
  python scripts/check_data_freshness.py --self-test   # valida el propio guard
"""

import argparse
import json
import math
import sys
import tempfile
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

DEFAULT_ROOT = Path(__file__).resolve().parent.parent
GEOS = ["8741", "8742", "8743", "8744", "8745"]

PVPC_MAX_LAG_DAYS = 1
SURPLUS_MAX_LAG_DAYS = 2
SSAA_MAX_LAG_MONTHS = 2


def today_madrid():
    try:
        return datetime.now(ZoneInfo("Europe/Madrid")).date()
    except Exception:
        # Sin base de datos de zonas horarias (p.ej. Windows sin tzdata):
        # UTC difiere de Madrid en 1-2h, irrelevante con umbrales de dias.
        return datetime.utcnow().date()


def month_files(base_dir, geo):
    geo_dir = Path(base_dir) / geo
    return sorted(geo_dir.glob("[0-9][0-9][0-9][0-9]-[0-9][0-9].json"))


def latest_day_in_dataset(base_dir, geo):
    """Devuelve el dia mas reciente que contiene al menos un punto real."""
    for month_file in reversed(month_files(base_dir, geo)):
        with open(month_file, encoding="utf-8") as fh:
            data = json.load(fh)
        days = data.get("days") or {}
        if not isinstance(days, dict):
            continue
        for day_iso in sorted(days, reverse=True):
            rows = days.get(day_iso)
            if isinstance(rows, list) and rows:
                return date.fromisoformat(day_iso)
    return None


def expected_hourly_points(day_iso, timezone_name):
    """Numero de horas civiles del dia local (23/24/25 segun DST)."""
    local_day = date.fromisoformat(day_iso)
    tz = ZoneInfo(timezone_name)
    start_local = datetime.combine(local_day, time.min, tzinfo=tz)
    end_local = datetime.combine(local_day + timedelta(days=1), time.min, tzinfo=tz)
    seconds = (
        end_local.astimezone(timezone.utc) - start_local.astimezone(timezone.utc)
    ).total_seconds()
    return int(seconds // 3600)


def _timestamp_from_row(row):
    if not isinstance(row, list) or not row:
        raise ValueError("fila no es una lista no vacia")
    raw = row[0]
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        raise ValueError("timestamp no numerico")
    if not math.isfinite(raw):
        raise ValueError("timestamp no finito")
    if int(raw) != raw:
        raise ValueError("timestamp no entero")
    return int(raw)


def _price_from_row(row):
    """Valida el precio (row[1]); exige fila de exactamente [timestamp, precio]."""
    if not isinstance(row, list) or len(row) != 2:
        raise ValueError("fila no tiene exactamente 2 elementos [timestamp, precio]")
    price = row[1]
    if isinstance(price, bool) or not isinstance(price, (int, float)):
        raise ValueError("precio no numerico")
    if not math.isfinite(price):
        raise ValueError("precio no finito")
    return float(price)


def daily_integrity_errors(base_dir, geo, reference_utc):
    """Valida completitud/continuidad usando el dia local vigente de cada fichero."""
    errores = []
    seen_days = {}
    for month_file in month_files(base_dir, geo):
        try:
            with open(month_file, encoding="utf-8") as fh:
                data = json.load(fh)
        except Exception as exc:
            errores.append(f"{geo}/{month_file.name}: error leyendo ({exc})")
            continue

        days = data.get("days") or {}
        if not isinstance(days, dict):
            errores.append(f"{geo}/{month_file.name}: 'days' no es un objeto")
            continue

        timezone_name = str(data.get("timezone") or "Europe/Madrid")
        try:
            tz = ZoneInfo(timezone_name)
        except Exception as exc:
            errores.append(
                f"{geo}/{month_file.name}: zona horaria invalida {timezone_name!r} ({exc})"
            )
            continue

        today_local = reference_utc.astimezone(tz).date()

        for day_iso, rows in sorted(days.items()):
            try:
                local_day = date.fromisoformat(day_iso)
                expected = expected_hourly_points(day_iso, timezone_name)
            except Exception as exc:
                errores.append(f"{geo}/{month_file.name} {day_iso}: fecha/zona invalida ({exc})")
                continue

            previous_source = seen_days.get(local_day)
            if previous_source is not None:
                errores.append(
                    f"{geo}/{month_file.name} {day_iso}: dia duplicado (tambien en {previous_source})"
                )
            else:
                seen_days[local_day] = month_file.name

            if not isinstance(rows, list):
                errores.append(f"{geo}/{month_file.name} {day_iso}: puntos no es una lista")
                continue

            actual = len(rows)
            if actual == 0:
                errores.append(f"{geo}/{month_file.name} {day_iso}: puntos=0")
                continue

            if local_day < today_local:
                if actual != expected:
                    errores.append(
                        f"{geo}/{month_file.name} {day_iso}: puntos={actual}, esperados={expected}"
                    )
            elif actual > expected:
                errores.append(
                    f"{geo}/{month_file.name} {day_iso}: puntos={actual}, maximo esperado={expected}"
                )

            previous_ts = None
            for idx, row in enumerate(rows):
                try:
                    ts = _timestamp_from_row(row)
                    _price_from_row(row)
                except ValueError as exc:
                    errores.append(
                        f"{geo}/{month_file.name} {day_iso}: fila {idx} invalida ({exc})"
                    )
                    break

                row_day = datetime.fromtimestamp(ts, timezone.utc).astimezone(tz).date()
                if row_day != local_day:
                    errores.append(
                        f"{geo}/{month_file.name} {day_iso}: timestamp de fila {idx} cae en {row_day}"
                    )
                    break

                if previous_ts is not None and ts - previous_ts != 3600:
                    errores.append(
                        f"{geo}/{month_file.name} {day_iso}: salto horario={ts - previous_ts}s en fila {idx}"
                    )
                    break
                previous_ts = ts

    sorted_days = sorted(seen_days)
    for previous_day, current_day in zip(sorted_days, sorted_days[1:]):
        gap_days = (current_day - previous_day).days
        if gap_days > 1:
            missing = gap_days - 1
            errores.append(
                f"{geo}: faltan {missing} dia(s) entre {previous_day} y {current_day}"
            )

    return errores


def months_ago(base_day, months):
    """Primer dia del mes situado `months` meses antes del mes de base_day."""
    year = base_day.year
    month = base_day.month - months
    while month < 1:
        month += 12
        year -= 1
    return date(year, month, 1)


def run_checks(root, geos=GEOS, hoy=None, reference_utc=None):
    """Ejecuta todos los chequeos. Devuelve (oks, errores) como listas de texto."""
    if reference_utc is None:
        if hoy is None:
            reference_utc = datetime.now(timezone.utc)
        else:
            # Los self-tests fijan `hoy`; mediodia UTC mantiene esa misma fecha
            # civil en las zonas soportadas y evita depender de la hora de ejecucion.
            reference_utc = datetime.combine(hoy, time(12), tzinfo=timezone.utc)
    elif reference_utc.tzinfo is None:
        raise ValueError("reference_utc debe incluir zona horaria")

    hoy = hoy or reference_utc.astimezone(ZoneInfo("Europe/Madrid")).date()
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

            integrity = daily_integrity_errors(base_dir, geo, reference_utc)
            errores.extend(f"{dataset}/{err}" for err in integrity)

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

        ssaa_values = ssaa.get("values")
        if not isinstance(ssaa_values, dict):
            errores.append("ssaa: 'values' no es un objeto")
        else:
            for ym, v in ssaa_values.items():
                if isinstance(v, bool) or not isinstance(v, (int, float)):
                    errores.append(f"ssaa/{ym}: valor no numerico")
                elif not math.isfinite(v):
                    errores.append(f"ssaa/{ym}: valor no finito")
    except Exception as exc:
        errores.append(f"ssaa: error leyendo index.json ({exc})")

    return oks, errores


# ---------------------------------------------------------------------------
# Self-test: valida el propio guard con fixtures sinteticos en un tmpdir.
# ---------------------------------------------------------------------------


def _rows_for_day(day_iso, timezone_name="Europe/Madrid", count=None, price=0.1):
    local_day = date.fromisoformat(day_iso)
    tz = ZoneInfo(timezone_name)
    start_local = datetime.combine(local_day, time.min, tzinfo=tz)
    start_ts = int(start_local.astimezone(timezone.utc).timestamp())
    expected = expected_hourly_points(day_iso, timezone_name)
    total = expected if count is None else count
    return [[start_ts + i * 3600, price] for i in range(total)]


def _write_month(root, dataset, geo, day_iso, *, count=None, timezone_name="Europe/Madrid", price=0.1):
    """Anade/reemplaza un dia sintetico conservando otros dias del mismo mes."""
    d = date.fromisoformat(day_iso)
    geo_dir = Path(root) / "data" / dataset / geo
    geo_dir.mkdir(parents=True, exist_ok=True)
    month_path = geo_dir / f"{d.strftime('%Y-%m')}.json"
    if month_path.exists():
        payload = json.loads(month_path.read_text(encoding="utf-8"))
        payload.setdefault("timezone", timezone_name)
        payload.setdefault("days", {})
    else:
        payload = {"timezone": timezone_name, "days": {}}
    payload["days"][day_iso] = _rows_for_day(day_iso, timezone_name, count, price)
    # allow_nan=True (default) a proposito: estos fixtures simulan deliberadamente un
    # precio NaN/Infinity que se coló pese a las defensas de ingesta (fix allow_nan=False
    # en produccion), para verificar que este guard lo detecta como ultima red.
    month_path.write_text(json.dumps(payload, allow_nan=True), encoding="utf-8")


def _write_ssaa(root, to_ym, value=0.001):
    ssaa_dir = Path(root) / "data" / "ssaa"
    ssaa_dir.mkdir(parents=True, exist_ok=True)
    with open(ssaa_dir / "index.json", "w", encoding="utf-8") as fh:
        json.dump({"to": to_ym, "values": {to_ym: value}}, fh, allow_nan=True)


def self_test():
    hoy = today_madrid()
    fallos = []
    total_checks = 0

    def check(nombre, esperado_errores, montar):
        nonlocal total_checks
        total_checks += 1
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
        stale = hoy - timedelta(days=10)
        geo_dir = Path(tmp) / "data" / "pvpc" / "8741"
        for month_file in geo_dir.glob("*.json"):
            month_file.unlink()
        _write_month(tmp, "pvpc", "8741", stale.isoformat())
    check("pvpc caducado", ["pvpc/8741: ultimo dia"], pvpc_rancio)

    # 3. Directorio de geo vacio: 'sin datos'
    def surplus_vacio(tmp):
        base_fresca(tmp)
        for f in (Path(tmp) / "data" / "surplus" / "8741").glob("*.json"):
            f.unlink()
    check("directorio vacio", ["surplus/8741: sin datos"], surplus_vacio)

    # 4. JSON invalido: el error de lectura se propaga de forma controlada
    def pvpc_corrupto(tmp):
        base_fresca(tmp)
        for f in (Path(tmp) / "data" / "pvpc" / "8741").glob("*.json"):
            f.write_text("{esto no es json", encoding="utf-8")
    check("json invalido", ["pvpc/8741: error leyendo dataset"], pvpc_corrupto)

    # 5. Mes con 'days' vacio: 'sin datos'
    def pvpc_sin_dias(tmp):
        base_fresca(tmp)
        for f in (Path(tmp) / "data" / "pvpc" / "8741").glob("*.json"):
            f.write_text(json.dumps({"timezone": "Europe/Madrid", "days": {}}), encoding="utf-8")
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

    # 8. Un dia historico parcial debe bloquear aunque el ultimo dia sea fresco.
    def historico_incompleto(tmp):
        base_fresca(tmp)
        old = hoy - timedelta(days=1)
        expected = expected_hourly_points(old.isoformat(), "Europe/Madrid")
        _write_month(tmp, "pvpc", "8741", old.isoformat(), count=expected - 1)
    check("historico incompleto", ["puntos="], historico_incompleto)

    # 9. El dia vigente puede estar parcial (publicacion aun en curso).
    def hoy_incompleto(tmp):
        base_fresca(tmp)
        expected = expected_hourly_points(hoy.isoformat(), "Europe/Madrid")
        _write_month(tmp, "pvpc", "8741", hoy.isoformat(), count=expected - 1)
    check("hoy parcial permitido", [], hoy_incompleto)

    # 10. Tambien puede estar parcial un dia futuro ya publicado.
    def futuro_incompleto(tmp):
        base_fresca(tmp)
        future = hoy + timedelta(days=1)
        expected = expected_hourly_points(future.isoformat(), "Europe/Madrid")
        _write_month(tmp, "pvpc", "8741", future.isoformat(), count=expected - 1)
    check("futuro parcial permitido", [], futuro_incompleto)

    # 11. Un hueco/duplicado horario historico se detecta incluso con 24 puntos.
    def historico_con_salto(tmp):
        base_fresca(tmp)
        old = hoy - timedelta(days=1)
        _write_month(tmp, "pvpc", "8741", old.isoformat())
        month_path = Path(tmp) / "data" / "pvpc" / "8741" / f"{old.strftime('%Y-%m')}.json"
        payload = json.loads(month_path.read_text(encoding="utf-8"))
        rows = payload["days"][old.isoformat()]
        rows[1][0] += 3600
        month_path.write_text(json.dumps(payload), encoding="utf-8")
    check("historico con salto horario", ["salto horario="], historico_con_salto)

    # 12. Una clave de dia sin puntos no puede fingir frescura.
    def dia_vacio_no_es_fresco(tmp):
        base_fresca(tmp)
        pvpc_file = Path(tmp) / "data" / "pvpc" / "8741" / f"{hoy.strftime('%Y-%m')}.json"
        payload = json.loads(pvpc_file.read_text(encoding="utf-8"))
        payload["days"] = {hoy.isoformat(): []}
        pvpc_file.write_text(json.dumps(payload), encoding="utf-8")
    check(
        "dia vacio no cuenta como fresco",
        ["puntos=0", "pvpc/8741: sin datos"],
        dia_vacio_no_es_fresco,
    )

    # 13. Un dia completamente ausente entre dos dias publicados tambien bloquea.
    def historico_con_dia_ausente(tmp):
        base_fresca(tmp)
        two_days_ago = hoy - timedelta(days=2)
        _write_month(tmp, "pvpc", "8741", two_days_ago.isoformat())
    check("historico con dia ausente", ["faltan 1 dia(s)"], historico_con_dia_ausente)

    # 14. Un precio NaN en un dia historico se detecta como fila invalida.
    def historico_con_precio_nan(tmp):
        base_fresca(tmp)
        old = hoy - timedelta(days=1)
        _write_month(tmp, "pvpc", "8741", old.isoformat(), price=float("nan"))
    check("precio NaN detectado", ["precio no finito"], historico_con_precio_nan)

    # 15. Un precio Infinity en un dia historico se detecta como fila invalida.
    def historico_con_precio_infinito(tmp):
        base_fresca(tmp)
        old = hoy - timedelta(days=1)
        _write_month(tmp, "surplus", "8741", old.isoformat(), price=float("inf"))
    check("precio Infinity detectado", ["precio no finito"], historico_con_precio_infinito)

    # 16. Un valor SSAA no finito se detecta.
    def ssaa_valor_no_finito(tmp):
        base_fresca(tmp)
        _write_ssaa(tmp, hoy.strftime("%Y-%m"), value=float("nan"))
    check("ssaa valor no finito detectado", ["valor no finito"], ssaa_valor_no_finito)

    # 17. La logica de completitud respeta los dias DST de 23 y 25 horas.
    total_checks += 1
    dst_ok = (
        expected_hourly_points("2026-03-29", "Europe/Madrid") == 23
        and expected_hourly_points("2026-10-25", "Europe/Madrid") == 25
        and expected_hourly_points("2026-03-29", "Atlantic/Canary") == 23
        and expected_hourly_points("2026-10-25", "Atlantic/Canary") == 25
    )
    if dst_ok:
        print("PASS dias DST 23/25h")
    else:
        fallos.append("dias DST 23/25h: conteo horario inesperado")
        print("FAIL dias DST 23/25h")

    if fallos:
        print("\nSELF-TEST FALLIDO:", file=sys.stderr)
        for fallo in fallos:
            print(f"  - {fallo}", file=sys.stderr)
        return 1
    print(f"\nSelf-test OK ({total_checks}/{total_checks}).")
    return 0


def main():
    parser = argparse.ArgumentParser(description="Guardia de frescura e integridad de datasets")
    parser.add_argument("--root", default=str(DEFAULT_ROOT), help="raiz del repo (o fixtures)")
    parser.add_argument("--self-test", action="store_true", help="valida el guard con fixtures sinteticos")
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    oks, errores = run_checks(args.root)
    for ok in oks:
        print(f"OK  {ok}")
    if errores:
        print("\nDATOS RANCIOS, INCOMPLETOS O ILEGIBLES:", file=sys.stderr)
        for err in errores:
            print(f"  - {err}", file=sys.stderr)
        return 1
    print("\nTodos los datasets estan frescos y su historico diario esta integro.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
