"""
从 we-mp-rss 的 SQLite 数据库导出公众号 RSS 订阅清单。
输出格式：公众号名称 + RSS URL，每行一个。
用法：python export_werss_rss.py
"""
import sqlite3
import os
import sys

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'we-mp-rss', 'data', 'db.db')
WERSS_BASE_URL = os.environ.get('WERSS_BASE_URL', 'http://localhost:8001')

def export_rss_list(base_url=None, output_file=None):
    if base_url is None:
        base_url = WERSS_BASE_URL
    base_url = base_url.rstrip('/')

    if not os.path.exists(DB_PATH):
        print(f"错误：数据库文件不存在 - {DB_PATH}", file=sys.stderr)
        sys.exit(1)

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT id, mp_name FROM feeds WHERE status = 1 ORDER BY created_at")
    rows = cursor.fetchall()
    conn.close()

    if not rows:
        print("暂无已订阅的公众号。")
        return

    lines = []
    for feed_id, mp_name in rows:
        rss_url = f"{base_url}/feed/{feed_id}.rss"
        lines.append(f"{mp_name}\t{rss_url}")

    result = '\n'.join(lines)

    if output_file:
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(result + '\n')
        print(f"已导出 {len(rows)} 个公众号 RSS 到 {output_file}")
    else:
        print(f"=== 共 {len(rows)} 个公众号 RSS 订阅 ===\n")
        print(result)

if __name__ == '__main__':
    out = None
    base = WERSS_BASE_URL
    for arg in sys.argv[1:]:
        if arg.startswith('--base='):
            base = arg.split('=', 1)[1]
        elif arg.startswith('--out='):
            out = arg.split('=', 1)[1]
        elif arg in ('-h', '--help'):
            print("用法: python export_werss_rss.py [--base=http://localhost:8001] [--out=rss_list.txt]")
            sys.exit(0)
    export_rss_list(base_url=base, output_file=out)
