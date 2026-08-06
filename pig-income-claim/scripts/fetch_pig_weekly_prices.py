#!/usr/bin/env python3
"""从重庆市农业农村委《重庆农产品及农资价格周报》提取生猪本周均价。

唯一取数口径：周报“肉禽蛋价格及比较”图片表格中，“生猪”行与
“本周均价（元/公斤）”列交叉处的数值。提取后再与正文公布的
生猪收购价环比变化交叉校验。

任何无法唯一识别或无法通过校验的数据只写入日志，不写入JSON。
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import io
import json
import logging
import re
import shutil
import subprocess
import tempfile
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

BASE_URL = "https://nyncw.cq.gov.cn"
LIST_URLS = [
    f"{BASE_URL}/xxgk_161/sczx/index.html",
    *[f"{BASE_URL}/xxgk_161/sczx/index_{page}.html" for page in range(1, 6)],
]
USER_AGENT = "pig-income-claim-price-updater/1.0 (+GitHub Actions)"
TIMEOUT = 30
PRICE_MIN = 5.0
PRICE_MAX = 40.0


class PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[tuple[str, str]] = []
        self.images: list[str] = []
        self.text_parts: list[str] = []
        self._link_href: str | None = None
        self._link_text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "a" and attributes.get("href"):
            self._link_href = attributes["href"]
            self._link_text = []
        if tag == "img" and attributes.get("src"):
            self.images.append(attributes["src"])

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._link_href:
            self.links.append((self._link_href, "".join(self._link_text).strip()))
            self._link_href = None
            self._link_text = []

    def handle_data(self, data: str) -> None:
        text = data.strip()
        if text:
            self.text_parts.append(text)
            if self._link_href:
                self._link_text.append(text)

    @property
    def text(self) -> str:
        return "\n".join(self.text_parts)


def fetch_bytes(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return response.read()


def fetch_html(url: str) -> str:
    raw = fetch_bytes(url)
    for encoding in ("utf-8", "gb18030"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def parse_page(html: str) -> PageParser:
    parser = PageParser()
    parser.feed(html)
    return parser


def normalize_url(base: str, value: str) -> str:
    return urllib.parse.urljoin(base, value)


def discover_articles() -> list[str]:
    discovered: dict[str, str] = {}
    for list_url in LIST_URLS:
        try:
            page = parse_page(fetch_html(list_url))
        except Exception as exc:  # noqa: BLE001 - 必须把单页失败写入日志后继续
            logging.warning("周报列表页读取失败：%s；%s", list_url, exc)
            continue
        for href, title in page.links:
            if "重庆农产品及农资价格周报" not in title:
                continue
            url = normalize_url(list_url, href)
            if "/sczx/" in url:
                discovered[url] = title
    return sorted(discovered)


def parse_title(text: str) -> tuple[int, int, str] | None:
    pattern = re.compile(r"(重庆农产品及农资价格周报)(\d{4})年第\s*(\d+)期")
    match = pattern.search(text.replace(" ", ""))
    if not match:
        return None
    return int(match.group(2)), int(match.group(3)), f"{match.group(1)}{match.group(2)}年第{match.group(3)}期"


def parse_publication_date(text: str, url: str) -> str | None:
    match = re.search(r"日期[：:]\s*(\d{4})[-年./](\d{1,2})[-月./](\d{1,2})", text)
    if not match:
        match = re.search(r"/t(\d{4})(\d{2})(\d{2})_", url)
    return f"{match.group(1)}-{int(match.group(2)):02d}-{int(match.group(3)):02d}" if match else None


def parse_monitoring_period(text: str, year: int, week: int) -> tuple[str, str] | None:
    compact = text.replace(" ", "")
    match = re.search(
        rf"第\s*{week}\s*周[^\d]{{0,12}}(\d{{4}})[.\-/年](\d{{1,2}})[.\-/月](\d{{1,2}}).*?(\d{{4}})[.\-/年](\d{{1,2}})[.\-/月](\d{{1,2}})",
        compact,
    )
    if match:
        start = dt.date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
        end = dt.date(int(match.group(4)), int(match.group(5)), int(match.group(6)))
        return start.isoformat(), end.isoformat()

    # 官方周次按周一至周日；第一期可能跨年，因此仅在正文未取到周期时作日历映射。
    monday = dt.date.fromisocalendar(year, week, 1)
    sunday = monday + dt.timedelta(days=6)
    return monday.isoformat(), sunday.isoformat()


def extract_text_price(text: str) -> float | None:
    patterns = [
        r"待宰活猪收购均价\s*(?:为)?\s*([0-9]+(?:\.[0-9]+)?)\s*元",
        r"待宰活猪[^。\n]{0,30}?均价\s*([0-9]+(?:\.[0-9]+)?)\s*元",
    ]
    for pattern in patterns:
        match = re.search(pattern, text)
        if match and PRICE_MIN <= float(match.group(1)) <= PRICE_MAX:
            return float(match.group(1))
    return None


def extract_change(text: str) -> tuple[str, float] | None:
    compact = re.sub(r"\s+", "", text)
    match = re.search(r"生猪收购价[^。]{0,90}?(上涨|下跌|上浮|下滑)([0-9]+(?:\.[0-9]+)?)%", compact)
    if not match:
        return None
    direction = "up" if match.group(1) in {"上涨", "上浮"} else "down"
    return direction, float(match.group(2))


def tesseract_candidates(image_bytes: bytes) -> list[tuple[float, float, str]]:
    if not shutil.which("tesseract"):
        raise RuntimeError("未安装Tesseract OCR；无法处理新版图片周报")
    with tempfile.TemporaryDirectory(prefix="pig-price-ocr-") as temp_dir:
        image_path = Path(temp_dir) / "report-image.png"
        image_path.write_bytes(image_bytes)
        # PSM 4按列布局识别表格。实测PSM 6会把首行“生猪”误识别为其他字符，
        # 而PSM 4能同时保留“生猪”行标签和各数值列的左右顺序。
        command = ["tesseract", str(image_path), "stdout", "-l", "chi_sim+eng", "--psm", "4", "tsv"]
        result = subprocess.run(command, check=True, capture_output=True, text=True)

    rows = list(csv.DictReader(io.StringIO(result.stdout), delimiter="\t"))
    grouped: dict[tuple[str, str, str, str], list[dict[str, str]]] = {}
    for row in rows:
        text = (row.get("text") or "").strip()
        if not text:
            continue
        key = tuple(row.get(name, "") for name in ("page_num", "block_num", "par_num", "line_num"))
        grouped.setdefault(key, []).append(row)

    lines: list[tuple[list[dict[str, str]], str]] = []
    for words in grouped.values():
        ordered = sorted(words, key=lambda word: int(word.get("left", "0") or 0))
        line = " ".join(word.get("text", "") for word in ordered)
        lines.append((ordered, line))

    # 先确认当前图片确实含有目标列，避免在其他周报图片中误取同名词或数字。
    has_target_header = any(
        "本周均价" in re.sub(r"\s+", "", line)
        and "元" in line
        and "公斤" in line
        for _, line in lines
    )
    if not has_target_header:
        return []

    candidates: list[tuple[float, float, str]] = []
    for words, line in lines:
        numeric_index = None
        numeric_value = None
        for index, word in enumerate(words):
            token = (word.get("text") or "").strip().replace(",", ".")
            if not re.fullmatch(r"[+-]?\d{1,3}(?:\.\d{1,4})?", token):
                continue
            value = float(token)
            if PRICE_MIN <= value <= PRICE_MAX:
                numeric_index = index
                numeric_value = value
                break
        if numeric_index is None or numeric_value is None:
            continue

        # 目标必须是第一列中完整、独立的“生猪”，不能把“加权生猪”或
        # “育肥猪饲料”等其他行当成目标行。该行的第一个合理数字就是
        # “本周均价（元/公斤）”列。
        row_label = re.sub(
            r"[\s|:：]+",
            "",
            "".join(word.get("text", "") for word in words[:numeric_index]),
        )
        if row_label != "生猪":
            continue

        price_word = words[numeric_index]
        confidence = float(price_word.get("conf", "-1") or -1)
        candidates.append((numeric_value, confidence, line))
    return candidates


def extract_image_price(page: PageParser, article_url: str) -> tuple[float, float, str] | None:
    image_urls = []
    for src in page.images:
        url = normalize_url(article_url, src)
        if "/sczx/" in url and ("ORIGIN" in url or url.lower().endswith((".png", ".jpg", ".jpeg"))):
            image_urls.append(url)
    for image_url in dict.fromkeys(image_urls):
        try:
            candidates = tesseract_candidates(fetch_bytes(image_url))
        except Exception as exc:  # noqa: BLE001
            logging.warning("图片识别失败：%s；%s", image_url, exc)
            continue
        prices = {round(item[0], 4) for item in candidates}
        if len(prices) == 1:
            return max(candidates, key=lambda item: item[1])
        if len(prices) > 1:
            logging.warning("单张图片OCR得到多个候选价格，继续检查下一张：%s", sorted(prices))

    return None


def previous_record(records: list[dict], year: int, week: int) -> dict | None:
    return next((record for record in records if record.get("year") == year and record.get("week") == week - 1), None)


def validate_ocr_price(price: float, confidence: float, change: tuple[str, float] | None, previous: dict | None) -> bool:
    if confidence < 55:
        logging.warning("OCR平均置信度不足：%.1f", confidence)
        return False
    if not change or not previous:
        return confidence >= 80
    previous_price = float(previous["pig_purchase_price"])
    direction, percent = change
    expected = previous_price * (1 + percent / 100 if direction == "up" else 1 - percent / 100)
    if round(expected + 1e-10, 2) != round(price, 2):
        logging.warning("OCR价格%.2f未通过环比交叉校验；按上期%.2f和%.2f%%推算为%.2f", price, previous_price, percent, expected)
        return False
    return True


def extract_article(article_url: str, existing_records: list[dict]) -> dict | None:
    html = fetch_html(article_url)
    page = parse_page(html)
    title_info = parse_title(page.text)
    if not title_info:
        logging.warning("无法识别周报标题：%s", article_url)
        return None
    year, week, title = title_info
    period = parse_monitoring_period(page.text, year, week)
    if not period:
        logging.warning("无法识别监测周期：%s", article_url)
        return None

    ocr = extract_image_price(page, article_url)
    if not ocr:
        logging.warning("未从周报图片唯一提取“生猪—本周均价”：%s", article_url)
        return None
    price, confidence, ocr_line = ocr
    change = extract_change(page.text)
    previous = previous_record(existing_records, year, week)
    if not validate_ocr_price(price, confidence, change, previous):
        return None
    extraction = f"图片OCR读取“生猪—本周均价”并环比交叉校验（置信度{confidence:.1f}）"
    logging.info("OCR命中“生猪”行：%s", ocr_line)

    now = dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).isoformat(timespec="seconds")
    return {
        "year": year,
        "week": week,
        "period_start": period[0],
        "period_end": period[1],
        "pig_purchase_price": round(float(price), 4),
        "unit": "元/公斤",
        "publication_date": parse_publication_date(page.text, article_url),
        "source_url": article_url,
        "source_title": title,
        "fetched_at": now,
        "status": extraction,
    }


def load_payload(path: Path) -> dict:
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {
        "schema_version": 1,
        "data_source": "重庆市农业农村委员会",
        "price_name": "待宰活猪收购均价",
        "updated_at": None,
        "latest_verified_week": None,
        "records": [],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--weekly-file", default="data/pig-weekly-prices.json")
    parser.add_argument("--article-url", action="append", help="仅检查指定周报，可重复传入")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    weekly_path = Path(args.weekly_file)
    payload = load_payload(weekly_path)
    records = list(payload.get("records", []))
    known = {(int(record["year"]), int(record["week"])) for record in records}
    article_urls = args.article_url or discover_articles()
    added = []

    for article_url in article_urls:
        try:
            record = extract_article(article_url, records + added)
        except Exception as exc:  # noqa: BLE001
            logging.error("周报处理失败：%s；%s", article_url, exc)
            continue
        if not record or (record["year"], record["week"]) in known:
            continue
        added.append(record)
        known.add((record["year"], record["week"]))
        logging.info("新增第%s周：%.2f元/公斤", record["week"], record["pig_purchase_price"])

    if not added:
        logging.info("没有通过校验的新周报数据，JSON未修改。")
        return 0

    records.extend(added)
    records.sort(key=lambda item: (int(item["year"]), int(item["week"])))
    payload["records"] = records
    payload["latest_verified_week"] = records[-1]["week"]
    payload["updated_at"] = dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).isoformat(timespec="seconds")
    if args.dry_run:
        logging.info("dry-run：通过校验%s条，不写入文件。", len(added))
        return 0
    weekly_path.parent.mkdir(parents=True, exist_ok=True)
    weekly_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
