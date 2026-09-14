import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
import urllib.error
import ssl
from pathlib import Path
from unittest.mock import MagicMock, patch

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
        self.assertTrue(fetcher.validate_ocr_price(11.80, 88, ("up", 1.54), previous))

    def test_low_confidence_still_rejected(self):
        self.assertFalse(fetcher.validate_ocr_price(12.65, 40, None, None))

    def test_all_list_pages_fail_is_error(self):
        with patch.object(fetcher, "fetch_html", side_effect=RuntimeError("network down")):
            with self.assertRaisesRegex(RuntimeError, "列表页读取失败"):
                fetcher.discover_articles()

    def test_empty_list_is_error_not_no_update(self):
        with patch.object(fetcher, "fetch_html", return_value="<html>maintenance</html>"):
            with self.assertRaisesRegex(RuntimeError, "未发现任何目标周报"):
                fetcher.discover_articles()

    def test_one_failed_list_page_is_not_reported_as_success(self):
        html = '<a href="/xxgk_161/sczx/example.html">重庆农产品及农资价格周报2026年第36期</a>'
        with patch.object(fetcher, "fetch_html", side_effect=[RuntimeError("network down")] + [html] * 5):
            with self.assertRaisesRegex(RuntimeError, "1个列表页"):
                fetcher.discover_articles()

    def test_valid_lists_discover_and_deduplicate(self):
        html = '<a href="/xxgk_161/sczx/example.html">重庆农产品及农资价格周报2026年第36期</a>'
        with patch.object(fetcher, "fetch_html", return_value=html):
            self.assertEqual(len(fetcher.discover_articles()), 1)

    def test_https_network_failure_can_use_same_official_http_path(self):
        url = "https://nyncw.cq.gov.cn/xxgk_161/sczx/example.html"
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b"official content"
        with patch.object(fetcher.urllib.request, "urlopen", side_effect=[
            urllib.error.URLError("network down"), urllib.error.URLError("network down"), response,
        ]) as opener, patch.object(fetcher.time, "sleep"):
            self.assertEqual(fetcher.fetch_bytes(url), b"official content")
            self.assertEqual([call.args[0].full_url for call in opener.call_args_list], [url, url, url.replace("https:", "http:")])

    def test_network_failure_exhausts_retries(self):
        with patch.object(fetcher.urllib.request, "urlopen", side_effect=urllib.error.URLError("down")) as opener, patch.object(fetcher.time, "sleep"):
            with self.assertRaisesRegex(RuntimeError, "重试后仍无法读取"):
                fetcher.fetch_bytes("https://nyncw.cq.gov.cn/xxgk_161/sczx/example.html")
            self.assertEqual(opener.call_count, 3)

    def test_forbidden_is_not_retried_or_downgraded(self):
        url = "https://nyncw.cq.gov.cn/xxgk_161/sczx/example.html"
        with patch.object(fetcher.urllib.request, "urlopen", side_effect=urllib.error.HTTPError(url, 403, "Forbidden", {}, None)) as opener:
            with self.assertRaises(urllib.error.HTTPError):
                fetcher.fetch_bytes(url)
            self.assertEqual(opener.call_count, 1)

    def test_certificate_error_is_not_ignored(self):
        with patch.object(fetcher.urllib.request, "urlopen", side_effect=urllib.error.URLError(ssl.SSLCertVerificationError("bad cert"))) as opener:
            with self.assertRaises(urllib.error.URLError):
                fetcher.fetch_bytes("https://nyncw.cq.gov.cn/xxgk_161/sczx/example.html")
            self.assertEqual(opener.call_count, 1)

    def test_other_hosts_are_not_downgraded(self):
        with patch.object(fetcher.urllib.request, "urlopen", side_effect=urllib.error.URLError("down")) as opener, patch.object(fetcher.time, "sleep"):
            with self.assertRaises(RuntimeError):
                fetcher.fetch_bytes("https://example.com/example.html")
            self.assertEqual(opener.call_count, 2)

    def test_server_error_retries_without_protocol_change(self):
        url = "https://nyncw.cq.gov.cn/xxgk_161/sczx/example.html"
        with patch.object(fetcher.urllib.request, "urlopen", side_effect=urllib.error.HTTPError(url, 503, "Unavailable", {}, None)) as opener, patch.object(fetcher.time, "sleep"):
            with self.assertRaises(RuntimeError):
                fetcher.fetch_bytes(url)
            self.assertEqual(opener.call_count, 2)

    def run_fetcher(self, initial, articles=None, extract=None, discovery_error=None, dry_run=False):
        with tempfile.TemporaryDirectory() as temp_dir:
            weekly = Path(temp_dir) / "weekly.json"
            before = json.dumps(initial, ensure_ascii=False)
            weekly.write_text(before, encoding="utf-8")
            argv = ["fetch", "--weekly-file", str(weekly)] + (["--dry-run"] if dry_run else [])
            with patch.object(sys, "argv", argv), patch.object(fetcher, "discover_articles", return_value=articles or [], side_effect=discovery_error), patch.object(fetcher, "extract_article", side_effect=extract) as extractor:
                code = fetcher.main()
                content = weekly.read_text(encoding="utf-8")
                return code, content, before, extractor.call_count

    def test_discovery_failure_preserves_file_and_returns_failure(self):
        code, after, before, calls = self.run_fetcher({"records": []}, discovery_error=RuntimeError("down"))
        self.assertEqual(code, 1)
        self.assertEqual(after, before)
        self.assertEqual(calls, 0)

    def test_existing_issue_new_url_skipped_before_article_or_ocr(self):
        initial = {"records": [{"year": 2026, "week": 36, "source_url": "old-url"}]}
        code, after, before, calls = self.run_fetcher(initial, [("new-url", "重庆农产品及农资价格周报2026年第36期")])
        self.assertEqual((code, calls), (0, 0))
        self.assertEqual(after, before)

    def test_extraction_failure_is_error_and_no_partial_writes(self):
        row = {"year": 2026, "week": 36, "pig_purchase_price": 12.65}
        code, after, before, calls = self.run_fetcher({"records": []}, [("url1", ""), ("url2", "")], [row, None])
        self.assertEqual((code, calls), (1, 2))
        self.assertEqual(after, before)

    def test_success_writes_image_value(self):
        row = {"year": 2026, "week": 36, "pig_purchase_price": 12.65}
        code, after, _, _ = self.run_fetcher({"records": []}, [("url1", "")], [row])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(after)["records"], [row])

    def test_dry_run_does_not_write(self):
        row = {"year": 2026, "week": 36, "pig_purchase_price": 12.65}
        code, after, before, _ = self.run_fetcher({"records": []}, [("url1", "")], [row], dry_run=True)
        self.assertEqual(code, 0)
        self.assertEqual(after, before)

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
            # No price change must preserve the timestamp, bytes and mtime.
            result["updated_at"] = "2020-01-01T00:00:00+08:00"
            daily.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
            before = daily.read_bytes()
            before_mtime = daily.stat().st_mtime_ns
            subprocess.run([
                sys.executable, str(ROOT / "scripts" / "build_daily_prices.py"),
                "--weekly-file", str(weekly), "--daily-file", str(daily), "--year", "2026",
            ], check=True, capture_output=True, text=True)
            self.assertEqual(daily.read_bytes(), before)
            self.assertEqual(daily.stat().st_mtime_ns, before_mtime)


if __name__ == "__main__":
    unittest.main()
