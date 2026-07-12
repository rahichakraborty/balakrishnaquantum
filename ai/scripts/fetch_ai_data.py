#!/usr/bin/env python3
"""
BKQ AI/ML — live data fetcher.

Pulls real, current data from public, no-auth-required APIs and writes
JSON snapshots into /data. Run on a schedule via GitHub Actions
(.github/workflows/ai-brief.yml) — same pattern as the market brief pipeline.

Sources:
  - arXiv API            (papers.json)     — latest cs.AI / cs.LG / cs.CL submissions
  - HN Algolia API        (hn.json)         — top AI-tagged Hacker News stories, last 7 days
  - GitHub Search API     (repos.json)      — trending AI/ML repos, last 14 days
  - Hugging Face Hub API  (models.json)     — trending models this week

No API keys required. Be a polite citizen: one request per source, small
page sizes, a descriptive User-Agent, and generous timeouts.
"""

import json
import time
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)

UA = "BKQ-AI-ML-Brief/1.0 (+https://balakrishnaquantum.com/ai-ml; contact via site)"
TIMEOUT = 20


def fetch(url, headers=None):
    req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return resp.read()


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ---------------------------------------------------------------------------
# 1. arXiv — latest papers across core AI/ML categories
# ---------------------------------------------------------------------------
def fetch_papers(max_results=12):
    query = "cat:cs.AI+OR+cat:cs.LG+OR+cat:cs.CL"
    params = {
        "search_query": query,
        "sortBy": "submittedDate",
        "sortOrder": "descending",
        "max_results": max_results,
    }
    url = "http://export.arxiv.org/api/query?" + urllib.parse.urlencode(params, safe="+:")
    xml_data = fetch(url)

    ns = {
        "atom": "http://www.w3.org/2005/Atom",
        "arxiv": "http://arxiv.org/schemas/atom",
    }
    root = ET.fromstring(xml_data)
    papers = []
    for entry in root.findall("atom:entry", ns):
        title = entry.find("atom:title", ns).text.strip().replace("\n", " ")
        summary = entry.find("atom:summary", ns).text.strip().replace("\n", " ")
        link = entry.find("atom:id", ns).text.strip()
        published = entry.find("atom:published", ns).text.strip()
        authors = [a.find("atom:name", ns).text for a in entry.findall("atom:author", ns)]
        primary_cat_el = entry.find("arxiv:primary_category", ns)
        primary_cat = primary_cat_el.get("term") if primary_cat_el is not None else ""
        papers.append({
            "title": title,
            "summary": (summary[:280] + "…") if len(summary) > 280 else summary,
            "authors": authors[:3] + (["et al."] if len(authors) > 3 else []),
            "link": link,
            "published": published,
            "category": primary_cat,
        })
    return papers


# ---------------------------------------------------------------------------
# 2. Hacker News (Algolia) — AI-tagged stories from the last 7 days
# ---------------------------------------------------------------------------
def fetch_hn(max_results=10):
    week_ago = int((datetime.now(timezone.utc) - timedelta(days=7)).timestamp())
    params = {
        "query": "AI OR LLM OR machine learning OR GenAI",
        "tags": "story",
        "numericFilters": f"created_at_i>{week_ago},points>40",
        "hitsPerPage": max_results,
    }
    url = "http://hn.algolia.com/api/v1/search_by_date?" + urllib.parse.urlencode(params)
    data = json.loads(fetch(url))
    stories = []
    for hit in data.get("hits", []):
        stories.append({
            "title": hit.get("title"),
            "url": hit.get("url") or f"https://news.ycombinator.com/item?id={hit.get('objectID')}",
            "points": hit.get("points"),
            "comments": hit.get("num_comments"),
            "hn_link": f"https://news.ycombinator.com/item?id={hit.get('objectID')}",
            "created_at": hit.get("created_at"),
        })
    return stories


# ---------------------------------------------------------------------------
# 3. GitHub — trending AI/ML repos created or pushed in the last 14 days
# ---------------------------------------------------------------------------
def fetch_repos(max_results=10):
    # GitHub's search API doesn't reliably support OR across multiple
    # `topic:` qualifiers in one query, so run one query per topic and
    # merge + dedupe client-side rather than fighting query syntax.
    since = (datetime.now(timezone.utc) - timedelta(days=14)).strftime("%Y-%m-%d")
    topics = ["llm", "machine-learning", "genai", "ai-agents"]

    seen = {}
    for topic in topics:
        params = {
            "q": f"topic:{topic} pushed:>{since}",
            "sort": "stars",
            "order": "desc",
            "per_page": 8,
        }
        url = "https://api.github.com/search/repositories?" + urllib.parse.urlencode(params)
        try:
            data = json.loads(fetch(url, headers={"Accept": "application/vnd.github+json"}))
        except Exception as e:
            print(f"WARN: repo topic '{topic}' failed: {e}")
            continue
        for item in data.get("items", []):
            name = item.get("full_name")
            if name and name not in seen:
                owner = item.get("owner") or {}
                seen[name] = {
                    "name": name,
                    "description": item.get("description"),
                    "url": item.get("html_url"),
                    "stars": item.get("stargazers_count"),
                    "language": item.get("language"),
                    "updated_at": item.get("pushed_at"),
                    "avatar_url": owner.get("avatar_url"),
                }
        time.sleep(0.5)  # stay well under GitHub's unauthenticated rate limit

    repos = sorted(seen.values(), key=lambda r: r["stars"] or 0, reverse=True)
    return repos[:max_results]


# ---------------------------------------------------------------------------
# 4. Hugging Face — trending models this week
# ---------------------------------------------------------------------------
def fetch_models(max_results=10):
    params = {"sort": "trendingScore", "direction": "-1", "limit": max_results}
    url = "https://huggingface.co/api/models?" + urllib.parse.urlencode(params)
    data = json.loads(fetch(url))
    models = []
    for m in data[:max_results]:
        models.append({
            "id": m.get("id"),
            "url": f"https://huggingface.co/{m.get('id')}",
            "downloads": m.get("downloads"),
            "likes": m.get("likes"),
            "pipeline_tag": m.get("pipeline_tag"),
        })
    return models


def write_json(name, payload):
    out = {"generated_at": now_iso(), "items": payload}
    path = DATA_DIR / name
    path.write_text(json.dumps(out, indent=2, ensure_ascii=False))
    print(f"wrote {path} ({len(payload)} items)")


def main():
    jobs = [
        ("papers.json", fetch_papers),
        ("hn.json", fetch_hn),
        ("repos.json", fetch_repos),
        ("models.json", fetch_models),
    ]
    for filename, fn in jobs:
        try:
            write_json(filename, fn())
        except Exception as e:
            print(f"WARN: {filename} fetch failed: {e}")
            # Don't crash the whole run if one source is flaky —
            # leave the previous snapshot in place.
        time.sleep(1)  # be polite between sources


if __name__ == "__main__":
    main()
