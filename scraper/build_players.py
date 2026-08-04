"""
data/all_records.json (ページ単位の生レコード) を選手名でグルーピングし、
Webアプリ用の data/players.json を生成する。
"""
import json
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parent.parent
IN_FILE = ROOT / "data" / "all_records.json"
OUT_FILE = ROOT / "webapp" / "data" / "players.json"


def main():
    records = json.loads(IN_FILE.read_text(encoding="utf-8"))

    players = defaultdict(list)
    for r in records:
        players[r["name"]].append({
            "year": r["year"],
            "level": r["level"],
            "levelLabel": r["level_label"],
            "kind": r["kind"],
            "kindLabel": r["kind_label"],
            "team": r["team_name"],
            "teamCode": r["team_code"],
            "mark": r["mark"],
            "stats": r["stats"],
        })

    # 各選手の成績を 年度降順 > 1軍優先 > 打撃優先 でソート
    kind_order = {"b": 0, "p": 1}
    for name, recs in players.items():
        recs.sort(key=lambda x: (-x["year"], x["level"], kind_order.get(x["kind"], 9)))

    # 選手名リストは五十音/文字コード順で安定させる
    out = dict(sorted(players.items(), key=lambda kv: kv[0]))

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(
        json.dumps(out, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"選手数: {len(out)}")
    print(f"総レコード数: {sum(len(v) for v in out.values())}")
    print(f"出力: {OUT_FILE} ({OUT_FILE.stat().st_size / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
