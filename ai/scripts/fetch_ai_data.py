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
import urllib.error
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


# ---------------------------------------------------------------------------
# 5. Book covers — Google Books, fetched server-side to avoid any browser
#    CORS/rate-limit uncertainty. Mirrors the BOOKS list in ai/index.html —
#    keep both in sync if the book list changes.
# ---------------------------------------------------------------------------
BOOKS = [
    ("Hands-On Machine Learning with Scikit-Learn, Keras & TensorFlow", "Aurélien Géron"),
    ("An Introduction to Statistical Learning (ISLR)", "James, Witten, Hastie, Tibshirani"),
    ("The Elements of Statistical Learning", "Hastie, Tibshirani, Friedman"),
    ("The Hundred-Page Machine Learning Book", "Andriy Burkov"),
    ("Deep Learning", "Goodfellow, Bengio, Courville"),
    ("Deep Learning with Python", "François Chollet"),
    ("Grokking Deep Learning", "Andrew W. Trask"),
    ("Speech and Language Processing", "Jurafsky & Martin"),
    ("Natural Language Processing with Transformers", "Tunstall, von Werra, Wolf"),
    ("Build a Large Language Model (From Scratch)", "Sebastian Raschka"),
    ("Python for Data Analysis", "Wes McKinney"),
    ("Data Science from Scratch", "Joel Grus"),
    ("Storytelling with Data", "Cole Nussbaumer Knaflic"),
    ("Prediction Machines", "Agrawal, Gans, Goldfarb"),
    ("AI Superpowers", "Kai-Fu Lee"),
]


def fetch_one_book_cover_openlibrary(title, author, debug_sink=None):
    """Primary source. No API key, and not on the same shared unauthenticated
    quota that got Google Books rate-limited (HTTP 429) from GitHub Actions'
    IP range in testing."""
    def try_query(q):
        params = {"q": q, "fields": "key,title,cover_i", "limit": 1}
        url = "https://openlibrary.org/search.json?" + urllib.parse.urlencode(params)
        raw = fetch(url)
        data = json.loads(raw)
        docs = data.get("docs") or []
        info = {"source": "openlibrary", "query": q, "num_found": data.get("numFound"), "docs_returned": len(docs)}
        if not docs or not docs[0].get("cover_i"):
            info["result"] = "no cover_i"
            if debug_sink is not None:
                debug_sink.append(info)
            return None
        cover_id = docs[0]["cover_i"]
        info["result"] = f"found cover_i={cover_id}"
        if debug_sink is not None:
            debug_sink.append(info)
        return f"https://covers.openlibrary.org/b/id/{cover_id}-M.jpg"

    result = try_query(f"{title} {author}")
    if not result:
        result = try_query(title)
    return result


def fetch_one_book_cover_google(title, author, debug_sink=None):
    """Secondary fallback only — Google's unauthenticated Books API shares a
    quota across all unauthenticated traffic hitting it from the same IP
    range, which GitHub Actions runners share with countless other jobs;
    it returned HTTP 429 on the very first request in testing."""
    def try_query(q):
        url = "https://www.googleapis.com/books/v1/volumes?" + urllib.parse.urlencode(
            {"q": q, "maxResults": 1}
        )
        raw = fetch(url)
        data = json.loads(raw)
        items = data.get("items") or []
        info = {"source": "google_books", "query": q, "items_returned": len(items)}
        if not items:
            info["result"] = "no items"
            if debug_sink is not None:
                debug_sink.append(info)
            return None
        links = items[0].get("volumeInfo", {}).get("imageLinks", {})
        thumb = links.get("thumbnail") or links.get("smallThumbnail")
        info["result"] = "found thumbnail" if thumb else "item found, no imageLinks"
        if debug_sink is not None:
            debug_sink.append(info)
        return thumb.replace("http://", "https://") if thumb else None

    result = try_query(f"{title} {author}")
    if not result:
        result = try_query(title)
    return result


# Direct ISBN overrides for specific books where title/author search doesn't
# resolve well (e.g. an acronym in the title confuses matching) — ISBN lookup
# is exact, no search ambiguity at all. Add more entries here if another book
# consistently comes up blank.
ISBN_OVERRIDES = {
    "An Introduction to Statistical Learning (ISLR)|James, Witten, Hastie, Tibshirani": "9781461471370",
}


def fetch_cover_by_isbn(isbn):
    """Open Library's ISBN endpoint returns a real image directly — if the ISBN
    has no cover, it returns a tiny 1x1 placeholder GIF rather than a 404, so we
    check the response size to tell the difference."""
    url = f"https://covers.openlibrary.org/b/isbn/{isbn}-M.jpg?default=false"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            if resp.status == 200:
                return url
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise
    return None


def fetch_one_book_cover(title, author, debug_sink=None):
    key = f"{title}|{author}"
    if key in ISBN_OVERRIDES:
        try:
            result = fetch_cover_by_isbn(ISBN_OVERRIDES[key])
            if debug_sink is not None:
                debug_sink.append({"source": "isbn_override", "isbn": ISBN_OVERRIDES[key], "result": "found" if result else "not found"})
            if result:
                return result
        except Exception as e:
            if debug_sink is not None:
                debug_sink.append({"source": "isbn_override", "exception": f"{type(e).__name__}: {e}"})

    result = fetch_one_book_cover_openlibrary(title, author, debug_sink=debug_sink)
    if not result:
        try:
            result = fetch_one_book_cover_google(title, author, debug_sink=debug_sink)
        except Exception as e:
            if debug_sink is not None:
                debug_sink.append({"source": "google_books", "exception": f"{type(e).__name__}: {e}"})
    return result


def fetch_book_covers():
    covers = {}
    debug_samples = []
    for idx, (title, author) in enumerate(BOOKS):
        key = f"{title}|{author}"
        # Capture full diagnostic detail for the first 3 books only — enough to
        # diagnose a systematic failure without bloating the JSON file.
        sink = debug_samples if idx < 3 else None
        try:
            url = fetch_one_book_cover(title, author, debug_sink=sink)
            covers[key] = url
            print(f"  cover for '{title}': {'found' if url else 'not found'}")
        except Exception as e:
            print(f"  WARN: cover lookup failed for '{title}': {e}")
            covers[key] = None
            if sink is not None:
                sink.append({"query": title, "exception": f"{type(e).__name__}: {e}"})
        time.sleep(0.5)  # stay well under Google's per-second burst limit
    return covers, debug_samples


def write_json(name, payload, error=None):
    out = {"generated_at": now_iso(), "items": payload}
    if error:
        out["error"] = error
    path = DATA_DIR / name
    path.write_text(json.dumps(out, indent=2, ensure_ascii=False))
    print(f"wrote {path} ({len(payload)} items{', ERROR: ' + error if error else ''})")


def fetch_with_retry(fn, attempts=2, delay=3):
    last_err = None
    for i in range(attempts):
        try:
            return fn(), None
        except Exception as e:
            last_err = f"{type(e).__name__}: {e}"
            print(f"  attempt {i+1}/{attempts} failed: {last_err}")
            time.sleep(delay)
    return [], last_err


def main():
    jobs = [
        ("papers.json", fetch_papers),
        ("hn.json", fetch_hn),
        ("repos.json", fetch_repos),
        ("models.json", fetch_models),
    ]
    for filename, fn in jobs:
        print(f"fetching {filename}...")
        payload, error = fetch_with_retry(fn)
        # Write every run, even on failure — a stale, silent file is
        # undiagnosable from outside the Actions log. An explicit "error"
        # field is visible just by opening the JSON.
        write_json(filename, payload, error=error)
        time.sleep(1)  # be polite between sources

    print("fetching book_covers.json...")
    try:
        covers, debug_samples = fetch_book_covers()
        cover_error = None
    except Exception as e:
        covers = {}
        debug_samples = []
        cover_error = f"{type(e).__name__}: {e}"
    out = {"generated_at": now_iso(), "covers": covers, "_debug_samples": debug_samples}
    if cover_error:
        out["error"] = cover_error
    (DATA_DIR / "book_covers.json").write_text(json.dumps(out, indent=2, ensure_ascii=False))
    found = sum(1 for v in covers.values() if v)
    print(f"wrote book_covers.json ({found}/{len(BOOKS)} covers found)")


if __name__ == "__main__":
    main()
