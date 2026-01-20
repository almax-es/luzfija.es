#!/usr/bin/env python3
"""
PVPC dataset builder - AUTO-FILL GAPS version

Nueva funcionalidad:
- Si ejecutas sin --from/--to, automáticamente:
  1. Detecta huecos en mes actual + anterior
  2. Descarga días faltantes + hoy + mañana
  3. Garantiza dataset completo sin huecos

Uso en GitHub Actions:
  python scripts/pvpc_auto_fill.py --out-dir data/pvpc --geos 8741 8742 8743 8744 8745

Uso manual (backfill completo):
  python scripts/pvpc_auto_fill.py --out-dir data/pvpc --geos 8741 --from 2025-01-01 --to 2026-01-14
"""

from __future__ import annotations

import argparse
import calendar
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from getpass import getpass
from typing import Dict, List, Tuple, Set

try:
    from zoneinfo import ZoneInfo
except Exception:
    print("ERROR: Python 3.9+ required (zoneinfo).", file=sys.stderr)
    raise

ESIOS_BASE = "https://api.esios.ree.es/indicators/1001"
ACCEPT_HEADER = "application/json; application/vnd.esios-api-v2+json"

GEO_TZ = {
    8742: "Atlantic/Canary",
}
DEFAULT_TZ = "Europe/Madrid"

MONTH_RE = re.compile(r"^\d{4}-\d{2}\.json$")

@dataclass(frozen=True)
class MonthRange:
    year: int
    month: int
    start_local: dt.date
    end_local: dt.date

def ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)

def write_json(path: str, obj: dict) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")

def read_json(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def parse_iso_datetime(s: str) -> dt.datetime:
    s = s.strip().replace("Z", "+00:00")
    return dt.datetime.fromisoformat(s)

def month_ranges(start: dt.date, end: dt.date) -> List[MonthRange]:
    ranges: List[MonthRange] = []
    y, m = start.year, start.month
    while True:
        first = dt.date(y, m, 1)
        last = dt.date(y, m, calendar.monthrange(y, m)[1])
        a = max(first, start)
        b = min(last, end)
        ranges.append(MonthRange(y, m, a, b))
        if y == end.year and m == end.month:
            break
        m += 1
        if m == 13:
            m = 1
            y += 1
    return ranges

def build_url(start_utc_iso: str, end_utc_iso: str, geo_id: int) -> str:
    q = {
        "start_date": start_utc_iso,
        "end_date": end_utc_iso,
        "geo_ids[]": str(geo_id),
    }
    return ESIOS_BASE + "?" + urllib.parse.urlencode(q, doseq=True)

def http_get_json(url: str, api_key: str, timeout_s: int = 60) -> dict:
    headers = {
        "Accept": ACCEPT_HEADER,
        "Content-Type": "application/json",
        "User-Agent": "luzfija-pvpc-auto-fill/3.0",
        "x-api-key": api_key,
    }
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw)
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        raise RuntimeError(
            f"HTTP {e.code} from ESIOS\nURL: {url}\nBody (first 1200 chars):\n{body[:1200]}"
        ) from e

def unit_suggests_mwh(unit_str: str) -> bool:
    return "mwh" in (unit_str or "").lower()

def extract_values(payload: dict) -> List[Tuple[dt.datetime, float]]:
    values = payload.get("indicator", {}).get("values") or []
    out: List[Tuple[dt.datetime, float]] = []
    for v in values:
        ts = v.get("datetime_utc") or v.get("datetime")
        val = v.get("value")
        if ts is None or val is None:
            continue
        try:
            dtu = parse_iso_datetime(str(ts))
            fv = float(val)
        except Exception:
            continue
        out.append((dtu, fv))
    out.sort(key=lambda x: x[0])
    return out

def to_utc_range_for_local_days(tz: ZoneInfo, start_day: dt.date, end_day: dt.date) -> Tuple[str, str]:
    start_local = dt.datetime(start_day.year, start_day.month, start_day.day, 0, 0, 0, tzinfo=tz)
    end_local = dt.datetime(end_day.year, end_day.month, end_day.day, 23, 59, 59, tzinfo=tz)
    start_utc = start_local.astimezone(dt.timezone.utc)
    end_utc = end_local.astimezone(dt.timezone.utc)
    return start_utc.isoformat(timespec="seconds"), end_utc.isoformat(timespec="seconds")

def build_days(payload: dict, tz: ZoneInfo, start_day: dt.date, end_day: dt.date) -> Tuple[Dict[str, List[List[float]]], dict]:
    ind = payload.get("indicator", {}) or {}
    unit = ind.get("unit") or ind.get("magnitud") or ind.get("magnitude") or ""
    suggests_mwh = unit_suggests_mwh(str(unit))
    pts = extract_values(payload)

    prices: List[Tuple[dt.datetime, float]] = []
    for dtu, raw in pts:
        v = raw / 1000.0 if suggests_mwh else raw
        prices.append((dtu, v))

    max_v = max([v for _, v in prices], default=0.0)
    heuristic = False
    if max_v > 10.0:
        heuristic = True
        prices = [(dtu, v / 1000.0) for dtu, v in prices]
        max_v = max([v for _, v in prices], default=0.0)

    days: Dict[str, List[List[float]]] = {}
    for dtu, v in prices:
        local_day = dtu.astimezone(tz).date()
        if local_day < start_day or local_day > end_day:
            continue
        key = local_day.isoformat()
        epoch_s = int(dtu.timestamp())
        days.setdefault(key, []).append([epoch_s, float(v)])

    for k in list(days.keys()):
        days[k].sort(key=lambda p: p[0])

    meta = {
        "unit_from_api": unit,
        "unit_suggests_mwh": suggests_mwh,
        "heuristic_applied": heuristic,
        "max_after_conversion": max_v,
    }
    return days, meta

def validate_days(days: Dict[str, List[List[float]]]) -> List[str]:
    warnings: List[str] = []
    for day, arr in days.items():
        n = len(arr)
        if n not in (23, 24, 25):
            warnings.append(f"{day}: unexpected hours={n}")
        for i in range(1, n):
            if arr[i][0] <= arr[i-1][0]:
                warnings.append(f"{day}: non-monotonic epoch at idx {i}")
                break
    return warnings

def merge_month_file(out_path: str, new_obj: dict) -> dict:
    if not os.path.exists(out_path):
        return new_obj

    old = read_json(out_path)
    if old.get("schema_version") != 2:
        raise RuntimeError(f"Existing file is not schema_version=2: {out_path}")

    for k in ("geo_id", "timezone", "indicator", "unit", "epoch_unit"):
        if str(old.get(k)) != str(new_obj.get(k)):
            raise RuntimeError(f"Incompatible {k} in {out_path}: old={old.get(k)} new={new_obj.get(k)}")

    old_days = old.get("days") or {}
    new_days = new_obj.get("days") or {}

    if not isinstance(old_days, dict) or not isinstance(new_days, dict):
        raise RuntimeError(f"Bad days shape in merge for {out_path}")

    old_days.update(new_days)

    keys = sorted(old_days.keys())
    if keys:
        new_obj["from"] = keys[0]
        new_obj["to"] = keys[-1]
    else:
        new_obj["from"] = new_obj.get("from")
        new_obj["to"] = new_obj.get("to")

    new_obj["days"] = old_days
    return new_obj

def rebuild_geo_index(geo_dir: str, geo_id: int, tz_name: str, generated_at_utc: str) -> dict:
    files = []
    warnings = []
    for name in sorted(os.listdir(geo_dir)):
        if not MONTH_RE.match(name):
            continue
        path = os.path.join(geo_dir, name)
        try:
            obj = read_json(path)
            if obj.get("schema_version") != 2:
                continue
            files.append({"file": name, "from": obj.get("from"), "to": obj.get("to")})
            if obj.get("warnings"):
                warnings.extend([f"{name} {w}" for w in obj.get("warnings")])
        except Exception as e:
            warnings.append(f"{name} read_error: {e}")

    return {
        "schema_version": 2,
        "generated_at_utc": generated_at_utc,
        "geo_id": geo_id,
        "timezone": tz_name,
        "indicator": 1001,
        "unit": "EUR/kWh",
        "epoch_unit": "s",
        "files": files,
        "warnings": warnings,
    }

def detect_missing_days(geo_dir: str, current_month: str, previous_month: str) -> Set[dt.date]:
    """Detecta días faltantes en mes actual y anterior"""
    missing = set()
    
    for yyyymm in [previous_month, current_month]:
        file_path = os.path.join(geo_dir, f"{yyyymm}.json")
        if not os.path.exists(file_path):
            continue
        
        try:
            data = read_json(file_path)
            existing_days = set(data.get("days", {}).keys())
            
            # Calcular todos los días que deberían existir en ese mes
            year, month = map(int, yyyymm.split("-"))
            last_day = calendar.monthrange(year, month)[1]
            
            # Limitar al mes completo o hasta hoy
            today = dt.date.today()
            if year == today.year and month == today.month:
                last_day = min(last_day, today.day)
            
            expected_days = {
                dt.date(year, month, day).isoformat()
                for day in range(1, last_day + 1)
            }
            
            # Días que faltan
            missing_in_month = expected_days - existing_days
            missing.update(dt.date.fromisoformat(d) for d in missing_in_month)
        except Exception as e:
            print(f"Warning: Error reading {file_path}: {e}", file=sys.stderr)
    
    return missing

def auto_detect_range(geo_dir: str, tz: ZoneInfo) -> Tuple[dt.date, dt.date]:
    """Detecta automáticamente el rango a descargar: huecos + mañana"""
    today = dt.datetime.now(tz).date()
    tomorrow = today + dt.timedelta(days=1)
    
    # Mes actual y anterior
    current_month = today.strftime("%Y-%m")
    if today.month == 1:
        previous_month = f"{today.year - 1}-12"
    else:
        previous_month = f"{today.year}-{today.month - 1:02d}"
    
    # Detectar días faltantes (incluyendo hoy si falta)
    missing = detect_missing_days(geo_dir, current_month, previous_month)
    
    if missing:
        # Descargar desde el primer día faltante hasta mañana
        start = min(missing)
        print(f"📊 Detectados {len(missing)} días faltantes desde {start}")
        return start, tomorrow
    else:
        # No hay huecos, solo descargar mañana
        print(f"✓ No hay huecos, descargando solo mañana")
        return tomorrow, tomorrow

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-dir", default="data/pvpc", help="Output root (default: data/pvpc)")
    ap.add_argument("--geos", nargs="+", type=int, default=[8741, 8742, 8743, 8744, 8745],
                    help="Geo IDs (default: 8741 8742 8743 8744 8745)")
    ap.add_argument("--from", dest="from_date", default=None, help="Start date (YYYY-MM-DD). Auto if omitted.")
    ap.add_argument("--to", dest="to_date", default=None, help="End date (YYYY-MM-DD). Auto if omitted.")
    ap.add_argument("--sleep", type=float, default=0.0, help="Sleep between requests (default: 0)")
    ap.add_argument("--timeout", type=int, default=60, help="HTTP timeout (default: 60)")
    args = ap.parse_args()

    api_key = os.environ.get("ESIOS_API_KEY") or os.environ.get("ESIOS_TOKEN")
    if not api_key:
        if sys.stdin.isatty():
            api_key = getpass("API key de ESIOS: ").strip()
        else:
            print("ERROR: ESIOS_API_KEY environment variable is missing and cannot prompt in non-interactive mode.", file=sys.stderr)
            return 2
    if not api_key:
        print("ERROR: missing API key", file=sys.stderr)
        return 2

    out_root = args.out_dir
    ensure_dir(out_root)

    generated_at = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")

    overall = {
        "schema_version": 2,
        "generated_at_utc": generated_at,
        "indicator": 1001,
        "unit": "EUR/kWh",
        "epoch_unit": "s",
        "geos": [],
    }

    for geo in args.geos:
        tz_name = GEO_TZ.get(geo, DEFAULT_TZ)
        tz = ZoneInfo(tz_name)

        geo_dir = os.path.join(out_root, str(geo))
        ensure_dir(geo_dir)

        # Auto-detectar rango si no se especificó
        if args.from_date:
            start = dt.date.fromisoformat(args.from_date)
            end = dt.date.fromisoformat(args.to_date) if args.to_date else dt.datetime.now(tz).date()
        else:
            start, end = auto_detect_range(geo_dir, tz)

        print(f"\n🌍 Geo {geo} ({tz_name}): {start} → {end}")

        if end < start:
            print(f"ERROR: end < start for geo {geo}", file=sys.stderr)
            return 2

        for mr in month_ranges(start, end):
            start_utc_iso, end_utc_iso = to_utc_range_for_local_days(tz, mr.start_local, mr.end_local)
            url = build_url(start_utc_iso, end_utc_iso, geo)

            payload = http_get_json(url, api_key, timeout_s=args.timeout)
            days, meta = build_days(payload, tz, mr.start_local, mr.end_local)

            warns = validate_days(days)

            out_name = f"{mr.year:04d}-{mr.month:02d}.json"
            out_path = os.path.join(geo_dir, out_name)

            month_obj = {
                "schema_version": 2,
                "geo_id": geo,
                "timezone": tz_name,
                "indicator": 1001,
                "unit": "EUR/kWh",
                "epoch_unit": "s",
                "from": mr.start_local.isoformat(),
                "to": mr.end_local.isoformat(),
                "days": days,
                "meta": meta,
            }
            if warns:
                month_obj["warnings"] = warns

            merged = merge_month_file(out_path, month_obj)
            write_json(out_path, merged)
            print(f"  ✓ {out_name}: +{len(days)} días (total: {len(merged.get('days', {}))})")

            if args.sleep > 0:
                time.sleep(args.sleep)

        geo_index = rebuild_geo_index(geo_dir, geo, tz_name, generated_at)
        write_json(os.path.join(geo_dir, "index.json"), geo_index)

        overall["geos"].append({"geo_id": geo, "timezone": tz_name, "path": f"{geo}/index.json"})

    write_json(os.path.join(out_root, "index.json"), overall)
    print(f"\n✅ Completado: {os.path.join(out_root, 'index.json')}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
