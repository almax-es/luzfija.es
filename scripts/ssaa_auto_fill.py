#!/usr/bin/env python3
"""
Monthly SSAA dataset builder.

Downloads ESIOS indicator 10328 (monthly system adjustment services component),
normalizes EUR/MWh to EUR/kWh and writes a compact local-first dataset.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import urllib.parse
import urllib.request
import urllib.error
from getpass import getpass
from typing import Dict, Tuple

try:
    from zoneinfo import ZoneInfo
except Exception:
    print("ERROR: Python 3.9+ required (zoneinfo).", file=sys.stderr)
    raise


ESIOS_BASE_TEMPLATE = "https://api.esios.ree.es/indicators/{indicator}"
ACCEPT_HEADER = "application/json; application/vnd.esios-api-v2+json"
DEFAULT_TZ = "Europe/Madrid"
DEFAULT_INDICATOR = 10328


def ensure_dir_for_file(path: str) -> None:
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)


def write_json(path: str, obj: dict) -> None:
    ensure_dir_for_file(path)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")


def parse_iso_datetime(value: str) -> dt.datetime:
    value = value.strip().replace("Z", "+00:00")
    return dt.datetime.fromisoformat(value)


def add_months(day: dt.date, months: int) -> dt.date:
    month_index = day.year * 12 + (day.month - 1) + months
    year = month_index // 12
    month = month_index % 12 + 1
    return dt.date(year, month, 1)


def to_utc_iso(local_day: dt.date, tz: ZoneInfo, end_of_day: bool = False) -> str:
    if end_of_day:
        local_dt = dt.datetime(local_day.year, local_day.month, local_day.day, 23, 59, 59, tzinfo=tz)
    else:
        local_dt = dt.datetime(local_day.year, local_day.month, local_day.day, 0, 0, 0, tzinfo=tz)
    return local_dt.astimezone(dt.timezone.utc).isoformat(timespec="seconds")


def build_url(indicator: int, start_utc_iso: str, end_utc_iso: str) -> str:
    base = ESIOS_BASE_TEMPLATE.format(indicator=indicator)
    query = {
        "locale": "es",
        "start_date": start_utc_iso,
        "end_date": end_utc_iso,
        "time_trunc": "month",
        "time_agg": "average",
    }
    return base + "?" + urllib.parse.urlencode(query)


def http_get_json(url: str, api_key: str, timeout_s: int = 60) -> dict:
    headers = {
        "Accept": ACCEPT_HEADER,
        "Content-Type": "application/json",
        "User-Agent": "luzfija-ssaa-auto-fill/1.0",
        "x-api-key": api_key,
    }
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        raise RuntimeError(
            f"HTTP {e.code} from ESIOS\nURL: {url}\nBody (first 1200 chars):\n{body[:1200]}"
        ) from e


def unit_text(unit_value) -> str:
    if isinstance(unit_value, dict):
        return str(unit_value.get("name") or unit_value.get("id") or "")
    if isinstance(unit_value, list):
        return " ".join(unit_text(item) for item in unit_value)
    return str(unit_value or "")


def unit_suggests_mwh(unit_value) -> bool:
    return "mwh" in unit_text(unit_value).lower()


def extract_monthly_values(payload: dict, tz: ZoneInfo) -> Tuple[Dict[str, float], dict]:
    indicator = payload.get("indicator", {}) or {}
    raw_values = indicator.get("values") or []
    source_unit = indicator.get("unit") or indicator.get("magnitud") or indicator.get("magnitude") or ""
    suggests_mwh = unit_suggests_mwh(source_unit)

    grouped: Dict[str, Tuple[dt.datetime, float, float]] = {}
    parse_errors = 0
    converted_by_heuristic = False

    for item in raw_values:
        raw_ts = item.get("datetime") or item.get("datetime_utc")
        raw_val = item.get("value")
        if raw_ts is None or raw_val is None:
            parse_errors += 1
            continue
        try:
            ts = parse_iso_datetime(str(raw_ts))
            raw_float = float(raw_val)
        except Exception:
            parse_errors += 1
            continue

        local_ts = ts.astimezone(tz)
        ym = f"{local_ts.year:04d}-{local_ts.month:02d}"
        eur_kwh = raw_float / 1000.0 if suggests_mwh else raw_float

        if not suggests_mwh and abs(eur_kwh) > 5:
            converted_by_heuristic = True
            eur_kwh = eur_kwh / 1000.0

        previous = grouped.get(ym)
        if previous is None or local_ts >= previous[0]:
            grouped[ym] = (local_ts, raw_float, eur_kwh)

    values = {
        ym: round(row[2], 6)
        for ym, row in sorted(grouped.items())
    }
    meta = {
        "source_unit": source_unit,
        "unit_suggests_mwh": suggests_mwh,
        "heuristic_applied": converted_by_heuristic,
        "raw_value_count": len(raw_values),
        "parse_error_count": parse_errors,
    }
    return values, meta


def latest_complete_month(values: Dict[str, float], tz: ZoneInfo, now: dt.datetime | None = None) -> str | None:
    now = now or dt.datetime.now(tz)
    current_ym = f"{now.year:04d}-{now.month:02d}"
    complete_months = [ym for ym in values if ym < current_ym]
    return max(complete_months) if complete_months else None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-file", default="data/ssaa/index.json", help="Output JSON file")
    parser.add_argument("--indicator", type=int, default=DEFAULT_INDICATOR, help="ESIOS indicator ID")
    parser.add_argument("--from", dest="from_date", default=None, help="Start date YYYY-MM-DD")
    parser.add_argument("--to", dest="to_date", default=None, help="End date YYYY-MM-DD")
    parser.add_argument("--months-back", type=int, default=24, help="Months back when --from is omitted")
    parser.add_argument("--timeout", type=int, default=60, help="HTTP timeout seconds")
    args = parser.parse_args()

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

    tz = ZoneInfo(DEFAULT_TZ)
    today = dt.datetime.now(tz).date()

    if args.from_date:
        start_day = dt.date.fromisoformat(args.from_date)
    else:
        start_day = add_months(dt.date(today.year, today.month, 1), -args.months_back)

    end_day = dt.date.fromisoformat(args.to_date) if args.to_date else today
    if end_day < start_day:
        print("ERROR: end date is before start date", file=sys.stderr)
        return 2

    start_utc = to_utc_iso(start_day, tz, end_of_day=False)
    end_utc = to_utc_iso(end_day, tz, end_of_day=True)
    url = build_url(args.indicator, start_utc, end_utc)
    payload = http_get_json(url, api_key, timeout_s=args.timeout)
    values, meta = extract_monthly_values(payload, tz)

    if not values:
        print("ERROR: no SSAA values returned by ESIOS", file=sys.stderr)
        return 1

    latest_month = latest_complete_month(values, tz)
    latest_value = values.get(latest_month) if latest_month else None
    generated_at = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")

    output = {
        "schema_version": 1,
        "generated_at_utc": generated_at,
        "source": "ESIOS",
        "source_url": ESIOS_BASE_TEMPLATE.format(indicator=args.indicator),
        "indicator": args.indicator,
        "name": "Precio medio mensual componente servicios ajuste del sistema",
        "timezone": DEFAULT_TZ,
        "unit": "EUR/kWh",
        "from": min(values),
        "to": max(values),
        "latest_complete_month": latest_month,
        "latest_value": latest_value,
        "values": values,
        "meta": meta,
    }

    write_json(args.out_file, output)
    print(f"SSAA dataset written: {args.out_file}")
    print(f"Latest complete month: {latest_month} = {latest_value} EUR/kWh")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
