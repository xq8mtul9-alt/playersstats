"""
webapp/ 一式（index.html, style.css, app.js, data/players.json）を
外部ファイル参照なしの単一HTMLファイルにまとめ、リポジトリ直下の index.html として書き出す
（GitHub Pagesがそのまま配信する）。
"""
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEBAPP = ROOT / "webapp"
PLAYERS_FILE = WEBAPP / "data" / "players.json"
OUT_FILE = ROOT / "index.html"


def main():
    index_html = (WEBAPP / "index.html").read_text(encoding="utf-8")
    style_css = (WEBAPP / "style.css").read_text(encoding="utf-8")
    app_js = (WEBAPP / "app.js").read_text(encoding="utf-8")
    players_json = PLAYERS_FILE.read_text(encoding="utf-8")

    link_tag = '<link rel="stylesheet" href="style.css">'
    assert link_tag in index_html
    html = index_html.replace(link_tag, f"<style>\n{style_css}\n</style>")

    script_tag = '<script src="app.js"></script>'
    assert script_tag in html
    embedded = f'<script>window.__EMBEDDED_PLAYERS__ = {players_json};</script>\n<script>\n{app_js}\n</script>'
    html = html.replace(script_tag, embedded)

    jst = timezone(timedelta(hours=9))
    now = datetime.now(jst).strftime("%Y年%m月%d日 %H:%M")
    timestamp_placeholder = "<!--BUILD_TIMESTAMP-->"
    assert timestamp_placeholder in html
    html = html.replace(timestamp_placeholder, f"最終更新: {now} JST")

    OUT_FILE.write_text(html, encoding="utf-8")
    size_mb = OUT_FILE.stat().st_size / (1024 * 1024)
    print(f"出力: {OUT_FILE} ({size_mb:.1f} MB)")


if __name__ == "__main__":
    main()
