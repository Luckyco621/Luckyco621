#!/usr/bin/env python3
"""
fetch_news.py — AI4S Executive Dashboard データ自動更新スクリプト

1. DuckDuckGo Search で「文部科学省 AI for Science」「大学 AI拠点」等を検索
2. requests + BeautifulSoup でページ本文を抽出
3. OpenRouter の google/gemini-2.0-flash-001 に実テキストを渡して JSON を生成
4. data/news_data.json / dates_index.json に保存

使用方法:
    OPENROUTER_API_KEY=your_key python scripts/fetch_news.py
"""

import json
import os
import re
import sys
import datetime
import time
import urllib.request
import urllib.error
import urllib.parse

import requests
from bs4 import BeautifulSoup
from ddgs import DDGS


# ---------------------------------------------------------------------------
# 設定
# ---------------------------------------------------------------------------
OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"

# 0 残高でも使える無料モデル（プライマリ → フォールバック）
FREE_MODELS = [
    "google/gemini-2.0-flash-001",
    "deepseek/deepseek-chat",
]
MODEL = os.environ.get("OPENROUTER_MODEL", FREE_MODELS[0])

OUTPUT_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "news_data.json")
DATES_FILE  = os.path.join(os.path.dirname(__file__), "..", "data", "dates_index.json")

# 検索クエリ（日本語・英語混在で幅広くカバー）
SEARCH_QUERIES = [
    "文部科学省 AI for Science 公募 2025 2026",
    "大学 AI拠点 筑波大学 慶應義塾 AI4S",
    "JST CREST さきがけ AI4S 公募",
    "NEDO AMED AI 科学研究 大学 連携",
    "Japan Ministry of Education AI for Science university hub",
]

MAX_RESULTS_PER_QUERY = 4   # 1クエリあたり最大取得件数
MAX_BODY_CHARS        = 800  # 1ページあたり抽出文字数上限
REQUEST_TIMEOUT       = 15   # HTTP タイムアウト（秒）


# ---------------------------------------------------------------------------
# Web スクレイピング
# ---------------------------------------------------------------------------

def search_duckduckgo(query: str, max_results: int = MAX_RESULTS_PER_QUERY) -> list[dict]:
    """DuckDuckGo でテキスト検索し、結果リストを返す"""
    try:
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=max_results))
        return results
    except Exception as exc:
        print(f"[WARN] DuckDuckGo search failed for '{query}': {exc}", file=sys.stderr)
        return []


def fetch_page_text(url: str) -> str:
    """URL のページ本文を取得し、プレーンテキストを返す（失敗時は空文字）"""
    try:
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (compatible; AI4SDashboard/1.0; "
                "+https://luckyco621.github.io/Luckyco621/)"
            )
        }
        resp = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        # script / style タグを除去
        for tag in soup(["script", "style", "nav", "footer", "header"]):
            tag.decompose()
        text = soup.get_text(separator="\n", strip=True)
        # 連続する空行を圧縮
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text[:MAX_BODY_CHARS]
    except Exception as exc:
        print(f"[WARN] Failed to fetch {url}: {exc}", file=sys.stderr)
        return ""


def gather_web_context() -> str:
    """複数クエリで検索し、スニペット＋本文を結合したコンテキスト文字列を返す"""
    seen_urls: set[str] = set()
    chunks: list[str] = []

    for query in SEARCH_QUERIES:
        print(f"[SEARCH] {query}", file=sys.stderr)
        results = search_duckduckgo(query)
        for r in results:
            url   = r.get("href", "")
            title = r.get("title", "")
            body  = r.get("body", "")

            if not url or url in seen_urls:
                continue
            seen_urls.add(url)

            # DuckDuckGo スニペットだけでも価値あり
            snippet = f"[SOURCE] {title}\n[URL] {url}\n{body}"

            # ページ本文の追加取得（gov / ac.jp ドメインを優先）
            domain = urllib.parse.urlparse(url).netloc
            if any(d in domain for d in [".go.jp", ".ac.jp", ".or.jp", "jst.go", "mext.go"]):
                page_text = fetch_page_text(url)
                if page_text:
                    snippet += f"\n--- page excerpt ---\n{page_text}"
                time.sleep(0.5)  # 礼儀ある待機

            chunks.append(snippet)

    return "\n\n===\n\n".join(chunks)


# ---------------------------------------------------------------------------
# OpenRouter 呼び出し
# ---------------------------------------------------------------------------

ANALYSIS_PROMPT = """あなたは岡山大学の経営層向けに AI4S（AI for Science）情報を整理するアナリストです。

今日の日付: {today}

以下は、Web から収集した最新の AI4S 関連情報（実際のページ・検索結果）です:

=== 収集情報 ===
{web_context}
=== 収集情報ここまで ===

上記の実際の収集情報を基に、**厳密に以下の JSON フォーマットのみ**を返してください（説明・マークダウン不要）。

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
      "impact_analysis": "岡山大学経営層向けの戦略的示唆（60字以内）",
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
      "impact_analysis": "岡山大学への戦略的示唆（80字以内）",
      "score": 80,
      "url": "https://..."
    }}
  ]
}}

重要なルール:
- 収集情報に含まれる実際の URL・機関名・日付を優先して使うこと
- 情報が不足する場合は推測を最小限にし、その旨を summary に反映すること
- score は重要度（0–100）を岡山大学視点で評価すること
- top_topics を 5 件、news を 8 件生成すること
- JSON のみを返すこと（コードブロック・説明文は一切不要）"""


def call_openrouter(api_key: str, today: str, now: str, web_context: str,
                    model: str = MODEL) -> dict:
    """OpenRouter API を呼び出し、解析済み JSON を返す"""
    prompt = ANALYSIS_PROMPT.format(today=today, now=now, web_context=web_context)

    payload = json.dumps({
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are an expert analyst. "
                    "Return ONLY valid JSON with no markdown fences or explanation."
                ),
            },
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.3,
        "max_tokens": 4096,
    }).encode("utf-8")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://luckyco621.github.io/Luckyco621/",
        "X-Title": "AI4S Executive Dashboard",
    }

    req = urllib.request.Request(
        OPENROUTER_API_URL, data=payload, headers=headers, method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"OpenRouter API error {e.code}: {err_body}") from e

    content = body["choices"][0]["message"]["content"].strip()

    # マークダウン コードブロック除去
    if content.startswith("```"):
        lines = content.splitlines()
        end = -1 if lines[-1].strip() == "```" else len(lines)
        content = "\n".join(lines[1:end])

    return json.loads(content)


def call_openrouter_with_fallback(api_key: str, today: str, now: str,
                                  web_context: str) -> dict:
    """プライマリモデルが失敗した場合にフォールバックモデルを試みる"""
    models_to_try = [MODEL] + [m for m in FREE_MODELS if m != MODEL]
    last_exc: Exception = RuntimeError("No models available")

    for model in models_to_try:
        try:
            print(f"[INFO] Trying model: {model}", file=sys.stderr)
            result = call_openrouter(api_key, today, now, web_context, model)
            print(f"[OK] Model succeeded: {model}", file=sys.stderr)
            return result
        except Exception as exc:
            print(f"[WARN] Model {model} failed: {exc}", file=sys.stderr)
            last_exc = exc

    raise last_exc


# ---------------------------------------------------------------------------
# dates_index.json 更新
# ---------------------------------------------------------------------------

def update_dates_index(today: str) -> None:
    """dates_index.json を更新し、最新日付を先頭に追加する（最大30件保持）"""
    dates_index: dict = {"latest": today, "dates": [today]}

    if os.path.exists(DATES_FILE):
        try:
            with open(DATES_FILE, "r", encoding="utf-8") as f:
                existing = json.load(f)
            existing_dates = existing.get("dates", [])
            merged = [today] + [d for d in existing_dates if d != today]
            dates_index["dates"] = merged[:30]
        except (json.JSONDecodeError, KeyError):
            pass

    with open(DATES_FILE, "w", encoding="utf-8") as f:
        json.dump(dates_index, f, ensure_ascii=False, indent=2)

    print(f"[OK] dates_index.json updated: {dates_index['dates'][:5]} ...")


# ---------------------------------------------------------------------------
# メイン
# ---------------------------------------------------------------------------

def main() -> None:
    api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        print("ERROR: OPENROUTER_API_KEY is not set.", file=sys.stderr)
        sys.exit(1)

    today = datetime.date.today().isoformat()
    now   = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # Step 1: Web スクレイピング
    print("[INFO] Step 1/3 — Scraping web for AI4S intelligence ...", file=sys.stderr)
    web_context = gather_web_context()
    print(f"[INFO] Collected {len(web_context)} chars of web context.", file=sys.stderr)

    # Step 2: AI 分析
    print(f"[INFO] Step 2/3 — Calling OpenRouter (primary={MODEL}) ...", file=sys.stderr)
    news_data = call_openrouter_with_fallback(api_key, today, now, web_context)

    # Step 3: ファイル保存
    print("[INFO] Step 3/3 — Saving results ...", file=sys.stderr)
    news_data.setdefault("last_updated", now)
    news_data.setdefault("date", today)

    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(news_data, f, ensure_ascii=False, indent=2)

    print(
        f"[OK] news_data.json saved "
        f"({len(news_data.get('top_topics', []))} top topics, "
        f"{len(news_data.get('news', []))} news items)"
    )

    update_dates_index(today)
    print("[DONE] All files updated successfully.")


if __name__ == "__main__":
    main()
