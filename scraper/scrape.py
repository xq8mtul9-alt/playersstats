"""
NPB.jp (https://npb.jp/bis/) から年度別・球団別の個人成績（1軍/2軍 x 打撃/投手）を取得する。

対象: 2016-2025年度、NPB12球団、1軍(公式戦)/2軍(ファーム)、打撃/投手
出力: data/raw/{year}_{level}_{kind}_{team}.json （生データ、ページ単位でキャッシュ）
      data/all_records.json （全レコードを1本にまとめたもの）

同じページは一度取得したらdata/rawにキャッシュし、再実行時は再取得しない（--forceで強制再取得）。
"""
import json
import re
import sys
import time
import argparse
from datetime import datetime
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE = "https://npb.jp/bis"
START_YEAR = 2005
YEARS = range(START_YEAR, datetime.now().year + 1)  # 2005年〜実行時点の年度まで

TEAMS = {
    "g": "読売ジャイアンツ",
    "t": "阪神タイガース",
    "c": "広島東洋カープ",
    "d": "中日ドラゴンズ",
    "db": "横浜DeNAベイスターズ",
    "s": "東京ヤクルトスワローズ",
    "h": "福岡ソフトバンクホークス",
    "f": "北海道日本ハムファイターズ",
    "l": "埼玉西武ライオンズ",
    "b": "オリックス・バファローズ",
    "m": "千葉ロッテマリーンズ",
    "e": "東北楽天ゴールデンイーグルス",
}

# level: 1 = 1軍(公式戦), 2 = 2軍(ファーム)
# kind: b = 打撃, p = 投手
LEVELS = {1: "1軍", 2: "2軍"}
KINDS = {"b": "打撃", "p": "投手"}

# チームのURLコードは年度によって変わることがある
TEAM_CODE_OVERRIDES = {
    "b": {y: "bs" for y in range(2005, 2018)},   # オリックス: 2005-2017年は "bs"、2018年以降は "b"
    "db": {y: "yb" for y in range(2005, 2012)},  # 横浜(DeNA): 2005-2011年は "yb"、2012年以降は "db"
}


def url_team_code(team_code: str, year: int) -> str:
    return TEAM_CODE_OVERRIDES.get(team_code, {}).get(year, team_code)

RAW_DIR = Path(__file__).resolve().parent.parent / "data" / "raw"
OUT_FILE = Path(__file__).resolve().parent.parent / "data" / "all_records.json"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; personal-stats-research-script/1.0)"
}

session = requests.Session()
session.headers.update(HEADERS)


def fetch_html(url: str, cache_path: Path, force: bool = False, retries: int = 3) -> str | None:
    if cache_path.exists() and not force:
        return cache_path.read_text(encoding="utf-8")

    for attempt in range(1, retries + 1):
        try:
            resp = session.get(url, timeout=20)
        except requests.RequestException as e:
            print(f"  [warn] {url} request error ({attempt}/{retries}): {e}")
            time.sleep(2 * attempt)
            continue

        if resp.status_code == 404:
            return None
        if resp.status_code != 200:
            print(f"  [warn] {url} status={resp.status_code} ({attempt}/{retries})")
            time.sleep(2 * attempt)
            continue

        resp.encoding = "utf-8"
        html = resp.text
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(html, encoding="utf-8")
        time.sleep(0.6)  # サイトへの負荷軽減
        return html

    print(f"  [error] giving up on {url}")
    return None


NAME_MARK_RE = re.compile(r"^[*+]+")


def _norm_header(text: str) -> str:
    """見出しテキストの空白（全角スペース含む）を除去して比較用に正規化する。"""
    return re.sub(r"[　\s]+", "", text)


# 古い年度のページでは縦書き見出しの都合で「ー」が「｜」になっていたり、
# 見出しの略し方が新しいページと異なる（例: ホール/ホールド）ことがある。
# 年度をまたいで同じ統計項目が同じキーになるよう正規化する。
HEADER_ALIASES = {
    "ホール": "ホールド",
}


def _canon_header(text: str) -> str:
    text = text.replace("｜", "ー")
    return HEADER_ALIASES.get(text, text)


# 選手名列の見出しは打撃ページでは「選手」、投手ページ(旧フォーマット)では「投手」になる
NAME_HEADERS = {"選手", "投手"}


def _find_stats_table(soup: BeautifulSoup):
    """選手名の見出しセルを含むテーブルを探す。
    NPB.jpは年度によりテーブルのマークアップ（class有無・th/td・見出し内の空白)が異なるため、
    見出しテキストを正規化して判定する。"""
    for table in soup.find_all("table"):
        for cell in table.find_all(["th", "td"]):
            if _norm_header(cell.get_text(strip=True)) in NAME_HEADERS:
                return table
    return None


def _find_header_row(table):
    for tr in table.find_all("tr"):
        cells = tr.find_all(["th", "td"])
        if any(_norm_header(c.get_text(strip=True)) in NAME_HEADERS for c in cells):
            return tr
    return None


def parse_table(html: str, year: int, level: int, kind: str, team_code: str, team_name: str, source_url: str):
    soup = BeautifulSoup(html, "html.parser")
    table = _find_stats_table(soup)
    if table is None:
        return []

    header_row = _find_header_row(table)
    if header_row is None:
        return []

    header_cells = header_row.find_all(["th", "td"])
    headers = [c.get_text(strip=True) for c in header_cells]

    name_idx = next(i for i, h in enumerate(headers) if _norm_header(h) in NAME_HEADERS)
    # 選手名の直前に見出しが空の列がある場合、そこは左打/左投マーク専用の列
    mark_idx = name_idx - 1 if name_idx > 0 and headers[name_idx - 1] == "" else None

    # 統計列を組み立てる。見出しが空の列は「直前の統計列のセル」に連結する
    # (例: 投球回が「投球回」列と無見出しの端数列に分かれているケースへの対応)
    stat_cols = []  # list of (header, [indices])
    for i, h in enumerate(headers):
        if i == name_idx or i == mark_idx:
            continue
        if h:
            stat_cols.append([_canon_header(h), [i]])
        elif stat_cols:
            stat_cols[-1][1].append(i)

    records = []
    started = False
    for tr in table.find_all("tr"):
        if tr is header_row:
            started = True
            continue
        if not started:
            continue
        cells = tr.find_all(["th", "td"])
        if len(cells) < len(headers):
            continue  # 注記行など、列数が合わない行はスキップ
        if name_idx >= len(cells):
            continue

        raw_name = cells[name_idx].get_text(strip=True)
        if not raw_name:
            continue

        mark_text = cells[mark_idx].get_text(strip=True) if mark_idx is not None else ""
        combined = (mark_text + raw_name) if mark_text else raw_name

        bat_throw_mark = NAME_MARK_RE.match(combined)
        mark = bat_throw_mark.group(0) if bat_throw_mark else ""
        clean_name = NAME_MARK_RE.sub("", combined).strip()
        # 選手名内の全角スペースを1つの半角スペースに正規化(表記ゆれ対策)
        normalized_name = re.sub(r"[　\s]+", " ", clean_name).strip()
        if not normalized_name:
            continue

        stats = {}
        for header, indices in stat_cols:
            value = "".join(cells[i].get_text(strip=True) for i in indices if i < len(cells))
            stats[header] = value

        records.append({
            "year": year,
            "level": level,
            "level_label": LEVELS[level],
            "kind": kind,
            "kind_label": KINDS[kind],
            "team_code": team_code,
            "team_name": team_name,
            "name": normalized_name,
            "name_raw": combined,
            "mark": mark,
            "stats": stats,
            "source_url": source_url,
        })
    return records


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="キャッシュを無視して再取得する")
    parser.add_argument("--years", type=str, default=None, help="例: 2020-2022 または 2023")
    args = parser.parse_args()

    years = list(YEARS)
    if args.years:
        if "-" in args.years:
            a, b = args.years.split("-")
            years = list(range(int(a), int(b) + 1))
        else:
            years = [int(args.years)]

    all_records = []
    total_pages = len(years) * len(TEAMS) * len(LEVELS) * len(KINDS)
    done = 0

    for year in years:
        for team_code, team_name in TEAMS.items():
            for level in LEVELS:
                for kind in KINDS:
                    done += 1
                    url_code = url_team_code(team_code, year)
                    fname = f"idb{level}_{url_code}.html" if kind == "b" else f"idp{level}_{url_code}.html"
                    url = f"{BASE}/{year}/stats/{fname}"
                    cache_path = RAW_DIR / str(year) / fname
                    print(f"[{done}/{total_pages}] {year} {team_name} {LEVELS[level]} {KINDS[kind]} -> {url}")

                    html = fetch_html(url, cache_path, force=args.force)
                    if html is None:
                        print(f"  [skip] not found: {url}")
                        continue

                    records = parse_table(html, year, level, kind, team_code, team_name, url)
                    print(f"  -> {len(records)} 件")
                    all_records.extend(records)

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(all_records, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n完了: {len(all_records)} 件のレコードを {OUT_FILE} に保存しました。")


if __name__ == "__main__":
    main()
