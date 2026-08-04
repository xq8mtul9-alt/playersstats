"""
NPB.jp の「選手一覧」ページ（https://npb.jp/bis/teams/rst_{team}.html）から
現在シーズンの背番号を取得する。

このページは常に「現在の」ロースターのみを表示し、過去年度のアーカイブは
存在しないため、取得できるのは実行時点の年度の背番号のみ。

出力: webapp/data/roster_numbers.json
  { "year": 2026, "teams": { "広島東洋カープ": { "森下 暢仁": "18", ... }, ... } }
"""
import json
import re
import time
from datetime import datetime
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE = "https://npb.jp/bis/teams"

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

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; personal-stats-research-script/1.0)"
}

OUT_FILE = Path(__file__).resolve().parent.parent / "webapp" / "data" / "roster_numbers.json"

session = requests.Session()
session.headers.update(HEADERS)


def normalize_name(raw: str) -> str:
    return re.sub(r"[　\s]+", " ", raw).strip()


def parse_roster(html: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    numbers = {}
    for table in soup.find_all("table", class_="rosterlisttbl"):
        skip_group = False
        for tr in table.find_all("tr"):
            ths = tr.find_all("th")
            if ths:
                header_texts = [th.get_text(strip=True) for th in ths]
                # 「監督」グループの行は選手ではないのでスキップする
                skip_group = len(header_texts) > 1 and header_texts[1] == "監督"
                continue
            if skip_group:
                continue
            tds = tr.find_all("td")
            if len(tds) < 2:
                continue
            number = tds[0].get_text(strip=True)
            name = normalize_name(tds[1].get_text(strip=True))
            if number and name:
                numbers[name] = number
    return numbers


def main():
    year = datetime.now().year
    all_teams = {}
    for code, team_name in TEAMS.items():
        url = f"{BASE}/rst_{code}.html"
        print(f"{team_name} -> {url}")
        resp = session.get(url, timeout=20)
        resp.encoding = "utf-8"
        numbers = parse_roster(resp.text)
        print(f"  -> {len(numbers)} 名")
        all_teams[team_name] = numbers
        time.sleep(0.6)

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(
        json.dumps({"year": year, "teams": all_teams}, ensure_ascii=False, indent=1),
        encoding="utf-8",
    )
    total = sum(len(v) for v in all_teams.values())
    print(f"\n完了: {year}年度 {total}名分の背番号を {OUT_FILE} に保存しました。")


if __name__ == "__main__":
    main()
