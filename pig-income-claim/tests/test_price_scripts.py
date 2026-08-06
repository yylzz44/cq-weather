import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_module(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(module)
    return module


fetcher = load_module("fetch_pig_weekly_prices", "fetch_pig_weekly_prices.py")


class PriceScriptTests(unittest.TestCase):
    def test_official_article_metadata_parsing(self):
        text = """
        重庆农产品及农资价格周报2026年第31期（第918期）
        日期： 2026-08-04
        据市农信中心31周（2026.07.27～2026.08.02）监测显示。
        本周生猪收购价、白条猪批发价分别上涨1.54%、1.57%。
        """
        self.assertEqual(fetcher.parse_title(text)[:2], (2026, 31))
        self.assertEqual(fetcher.parse_publication_date(text, ""), "2026-08-04")
        self.assertEqual(fetcher.parse_monitoring_period(text, 2026, 31), ("2026-07-27", "2026-08-02"))
        self.assertEqual(fetcher.extract_change(text), ("up", 1.54))

    def test_old_text_article_price_parsing(self):
        text = "据市农业农村委监测，第31周全市监测点待宰活猪收购均价16.56元/公斤。"
        self.assertEqual(fetcher.extract_text_price(text), 16.56)

    def test_ocr_cross_check_accepts_week31_value(self):
        previous = {"pig_purchase_price": 11.46}
        self.assertTrue(fetcher.validate_ocr_price(11.64, 88, ("up", 1.54), previous))
        self.assertFalse(fetcher.validate_ocr_price(11.80, 88, ("up", 1.54), previous))

    def test_daily_mapping_preserves_missing_days(self):
        weekly_payload = {
            "schema_version": 1,
            "latest_verified_week": 31,
            "records": [{
                "year": 2026,
                "week": 31,
                "period_start": "2026-07-27",
                "period_end": "2026-08-02",
                "pig_purchase_price": 11.64,
                "unit": "元/公斤",
                "source_url": "https://nyncw.cq.gov.cn/example",
                "source_title": "测试周报",
            }],
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            temp = Path(temp_dir)
            weekly = temp / "weekly.json"
            daily = temp / "daily.json"
            weekly.write_text(json.dumps(weekly_payload, ensure_ascii=False), encoding="utf-8")
            subprocess.run([
                sys.executable,
                str(ROOT / "scripts" / "build_daily_prices.py"),
                "--weekly-file", str(weekly),
                "--daily-file", str(daily),
                "--year", "2026",
            ], check=True, capture_output=True, text=True)
            result = json.loads(daily.read_text(encoding="utf-8"))
            priced = [row for row in result["records"] if row["price"] is not None]
            missing = [row for row in result["records"] if row["price"] is None]
            self.assertEqual(len(result["records"]), 365)
            self.assertEqual(len(priced), 7)
            self.assertEqual(len(missing), 358)
            self.assertEqual(priced[0]["date"], "2026-07-27")
            self.assertEqual(priced[-1]["date"], "2026-08-02")


if __name__ == "__main__":
    unittest.main()
