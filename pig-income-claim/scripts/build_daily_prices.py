#!/usr/bin/env python3
"""把周报待宰活猪收购均价映射为逐日价格，不补值、不顺延。"""

from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--weekly-file", default="data/pig-weekly-prices.json")
    parser.add_argument("--daily-file", default="data/pig-daily-prices.json")
    parser.add_argument("--year", type=int, default=2026)
    args = parser.parse_args()

    weekly_path = Path(args.weekly_file)
    daily_path = Path(args.daily_file)
    weekly = json.loads(weekly_path.read_text(encoding="utf-8"))
    mapped: dict[str, dict] = {}

    for record in weekly.get("records", []):
        start = dt.date.fromisoformat(record["period_start"])
        end = dt.date.fromisoformat(record["period_end"])
        if end < start:
            raise ValueError(f"第{record['week']}周周期结束日早于开始日")
        cursor = start
        while cursor <= end:
            if cursor.year == args.year:
                date_key = cursor.isoformat()
                if date_key in mapped:
                    raise ValueError(f"周报周期重叠：{date_key}")
                mapped[date_key] = {
                    "date": date_key,
                    "year": args.year,
                    "week": record["week"],
                    "price": record["pig_purchase_price"],
                    "unit": record.get("unit", "元/公斤"),
                    "source_url": record.get("source_url"),
                    "source_title": record.get("source_title"),
                    "status": "已核验" if record.get("source_url") else "待核验来源",
                }
            cursor += dt.timedelta(days=1)

    first = dt.date(args.year, 1, 1)
    last = dt.date(args.year, 12, 31)
    records = []
    cursor = first
    while cursor <= last:
        date_key = cursor.isoformat()
        records.append(mapped.get(date_key, {
            "date": date_key,
            "year": args.year,
            "week": None,
            "price": None,
            "unit": "元/公斤",
            "source_url": None,
            "source_title": None,
            "status": "待更新",
        }))
        cursor += dt.timedelta(days=1)

    now = dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).isoformat(timespec="seconds")
    payload = {
        "schema_version": 1,
        "data_source": "重庆市农业农村委员会",
        "price_name": "待宰活猪收购均价",
        "mapping_rule": "每一期周报价格映射至监测周全部自然日；起止日均计入；缺失不得估算或顺延。",
        "updated_at": now,
        "latest_verified_week": weekly.get("latest_verified_week"),
        "records": records,
    }
    daily_path.parent.mkdir(parents=True, exist_ok=True)
    daily_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"已生成{len(records)}个自然日；有价格{len(mapped)}天；缺失{len(records) - len(mapped)}天。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
