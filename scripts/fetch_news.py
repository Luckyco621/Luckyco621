#!/usr/bin/env python3
"""
fetch_news.py — AI4S Executive Dashboard データ自動更新スクリプト

OpenRouter API を使用して、日本の AI4S（AI for Science）関連の
最新動向・政策・公募情報を生成し、data/news_data.json に保存します。

使用方法:
    OPENROUTER_API_KEY=your_key python scripts/fetch_news.py
"""

import json
import os
import sys
import datetime
import urllib.request
import urllib.error


OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"
# 費用対効果の高いモデルを使用（必要に応じて変更可能）
MODEL = os.environ.get("OPENROUTER_MODEL", "google/gemini-2.0-flash-001")

OUTPUT_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "news_data.json")
DATES_FILE  = os.path.join(os.path.dirname(__file__), "..", "data", "dates_index.json")


PROMPT = """あなたは日本の大学・研究機関向けに AI4S（AI for Science）の情報を収集・整理する専門家です。

今日の日付: {today}

以下の JSON フォーマットで、日本の AI4S に関連する最新動向を 8 件生成してください。
実際の公募・政策・研究成果の情報を基にしてください（創作は最小限に）。

{{
  "date": "{today}",
  "last_updated": "{now}",
  "top_topics": [
    {{
      "id": 1,
      "title": "トピックタイトル（30字以内）",
      "info_type": "政策 | 公募 | 大学 | 国際連携 | 企業",
      "category": "policy | fund | university | international | industry",
      "date": "YYYY-MM-DD",
      "org": "発信元機関名",
      "summary": "概要（100字以内）",
      "impact_analysis": "岡山大学への示唆・影響（60字以内）",
      "score": 95,
      "url": "https://..."
    }}
  ],
  "news": [
    {{
      "id": 1,
      "title": "ニュースタイトル（40字以内）",
      "info_type": "政策 | 公募 | 大学 | 国際連携 | 企業",
      "category": "policy | fund | university | international | industry",
      "date": "YYYY-MM-DD",
      "org": "発信元機関名",
      "summary": "概要（120字以内）",
      "impact_analysis": "岡山大学への示唆（80字以内）",
      "score": 80,
      "url": "https://..."
    }}
  ]
}}

対象カテゴリ:
- 文部科学省・内閣府・JST・NEDO・AMEDの AI4S 関連公募・政策
- 日本の主要大学（東大・筑波・慶應・阪大・東北大など）の AI4S 拠点・プロジェクト
- 理研・産総研・NIIの AI4S 研究成果
- 日米・日欧の AI4S 国際連携
- NVIDIA・AWS・NTTなど企業の大学連携

top_topics を 5 件、news を 8 件生成してください。
JSON のみを返してください（説明文は不要）。"""


def call_openrouter(api_key: str, today: str, now: str) -> dict:
    """OpenRouter API を呼び出し、AI4S ニュースデータを取得する"""
    prompt = PROMPT.format(today=today, now=now)

    payload = json.dumps({
        "model": MODEL,
        "messages": [
            {
                "role": "system",
                "content": "You are an expert assistant that returns only valid JSON with no markdown or explanation.",
            },
            {
                "role": "user",
                "content": prompt,
            },
        ],
        "temperature": 0.7,
        "max_tokens": 4096,
    }).encode("utf-8")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://luckyco621.github.io/Luckyco621/",
        "X-Title": "AI4S Executive Dashboard",
    }

    req = urllib.request.Request(OPENROUTER_API_URL, data=payload, headers=headers, method="POST")

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"OpenRouter API error {e.code}: {err_body}") from e

    content = body["choices"][0]["message"]["content"].strip()

    # モデルが markdown コードブロックを返す場合に対応
    if content.startswith("```"):
        lines = content.splitlines()
        if len(lines) >= 3:
            content = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
        elif len(lines) == 2:
            content = lines[1]

    return json.loads(content)


def update_dates_index(today: str) -> None:
    """dates_index.json を更新し、最新日付を先頭に追加する（最大30件保持）"""
    dates_index = {"latest": today, "dates": [today]}

    if os.path.exists(DATES_FILE):
        try:
            with open(DATES_FILE, "r", encoding="utf-8") as f:
                existing = json.load(f)
            existing_dates = existing.get("dates", [])
            # 今日の日付を先頭に追加し、重複を除去
            merged = [today] + [d for d in existing_dates if d != today]
            dates_index["dates"] = merged[:30]  # 最新30件を保持
        except (json.JSONDecodeError, KeyError):
            pass

    with open(DATES_FILE, "w", encoding="utf-8") as f:
        json.dump(dates_index, f, ensure_ascii=False, indent=2)

    print(f"[OK] dates_index.json updated: {dates_index['dates'][:5]} ...")


def main() -> None:
    api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        print("ERROR: OPENROUTER_API_KEY environment variable is not set.", file=sys.stderr)
        sys.exit(1)

    today = datetime.date.today().isoformat()
    now   = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    print(f"[INFO] Fetching AI4S news via OpenRouter (model={MODEL}, date={today}) ...")

    news_data = call_openrouter(api_key, today, now)

    # last_updated が含まれていない場合は補完
    news_data.setdefault("last_updated", now)
    news_data.setdefault("date", today)

    # data/ ディレクトリが存在しない場合は作成
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(news_data, f, ensure_ascii=False, indent=2)

    print(f"[OK] news_data.json saved ({len(news_data.get('top_topics', []))} top topics, "
          f"{len(news_data.get('news', []))} news items)")

    update_dates_index(today)
    print("[DONE] All files updated successfully.")


if __name__ == "__main__":
    main()
