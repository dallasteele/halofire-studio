#!/usr/bin/env python3
"""
HaloFire UI Template Scraper
Uses Scrapling to discover professional dashboard templates from ThemeForest
and similar marketplaces.

Usage:
  python scraper.py search --query "admin dashboard" --framework react
  python scraper.py catalog --top 20
  python scraper.py preview --url <template_url>
"""

import json
import os
import sys
import time
import argparse
from datetime import datetime
from pathlib import Path

# Data directory for persisting results
DATA_DIR = Path(__file__).parent / "refs"
CATALOG_FILE = DATA_DIR / "template_catalog.json"
SEARCH_CACHE = DATA_DIR / "search_cache.json"

def ensure_scrapling():
    """Ensure scrapling is installed."""
    try:
        from scrapling.defaults import Fetcher, StealthyFetcher
        return True
    except ImportError:
        print("[!] Scrapling not installed. Run: pip install 'scrapling[fetchers]' && scrapling install")
        return False


def load_catalog():
    """Load existing template catalog."""
    if CATALOG_FILE.exists():
        return json.loads(CATALOG_FILE.read_text())
    return {"templates": [], "last_updated": None, "sources": []}


def save_catalog(catalog):
    """Persist catalog to disk."""
    catalog["last_updated"] = datetime.now().isoformat()
    CATALOG_FILE.write_text(json.dumps(catalog, indent=2))


def search_themeforest(query="admin dashboard", framework=None, min_rating=4.0,
                        max_price=100, page=1, max_pages=3):
    """
    Search ThemeForest for admin/dashboard templates.
    Returns structured metadata for each result.
    """
    from scrapling.defaults import StealthyFetcher

    results = []
    base_url = "https://themeforest.net/search/{query}"

    # Build search URL with filters
    search_terms = query.replace(" ", "%20")
    if framework:
        search_terms += f"%20{framework}"

    url = f"https://themeforest.net/search/{search_terms}?category=site-templates%2Fadmin-templates&sort=rating"

    for p in range(page, page + max_pages):
        page_url = f"{url}&page={p}" if p > 1 else url
        print(f"  [*] Fetching page {p}: {page_url}")

        try:
            response = StealthyFetcher.fetch(
                page_url,
                headless=True,
                network_idle=True,
                wait_selector=".product-list__item",
                timeout=30000
            )

            if response.status != 200:
                print(f"  [!] Got status {response.status}, stopping pagination")
                break

            # Extract template cards
            items = response.css(".product-list__item", auto_save=True)

            for item in items:
                try:
                    template = extract_template_card(item)
                    if template and template.get("rating", 0) >= min_rating:
                        if not max_price or template.get("price", 999) <= max_price:
                            results.append(template)
                except Exception as e:
                    print(f"  [!] Error parsing item: {e}")
                    continue

            print(f"  [+] Found {len(items)} items on page {p}")

            # Rate limiting — respect the marketplace
            time.sleep(2)

        except Exception as e:
            print(f"  [!] Error fetching page {p}: {e}")
            break

    return results


def extract_template_card(item):
    """Extract metadata from a ThemeForest product card element."""
    try:
        name_el = item.css_first(".product-list__heading a")
        price_el = item.css_first(".product-list__price .dollar-amount")
        rating_el = item.css_first(".star-rating__value")
        sales_el = item.css_first(".product-list__sales-count")
        img_el = item.css_first("img.product-list__thumbnail")
        author_el = item.css_first(".product-list__author a")
        category_el = item.css_first(".product-list__category a")

        template = {
            "name": name_el.text.strip() if name_el else "Unknown",
            "url": "https://themeforest.net" + name_el.attrib.get("href", "") if name_el else None,
            "price": float(price_el.text.strip().replace("$", "").replace(",", "")) if price_el else None,
            "rating": float(rating_el.text.strip()) if rating_el else None,
            "sales": int(sales_el.text.strip().replace(",", "").replace(" Sales", "")) if sales_el else 0,
            "thumbnail": img_el.attrib.get("src", "") if img_el else None,
            "author": author_el.text.strip() if author_el else "Unknown",
            "category": category_el.text.strip() if category_el else "Admin",
            "scraped_at": datetime.now().isoformat(),
            "source": "themeforest"
        }

        return template
    except Exception as e:
        return None


def preview_template(url):
    """
    Get detailed information about a specific template.
    Fetches the template's detail page and extracts:
    - Full description, screenshots, tech stack, features, demo URL
    """
    from scrapling.defaults import StealthyFetcher

    print(f"  [*] Fetching template details: {url}")

    response = StealthyFetcher.fetch(
        url,
        headless=True,
        network_idle=True,
        timeout=30000
    )

    if response.status != 200:
        return {"error": f"HTTP {response.status}"}

    detail = {
        "url": url,
        "scraped_at": datetime.now().isoformat()
    }

    # Title
    title = response.css_first("h1.t-heading")
    detail["name"] = title.text.strip() if title else "Unknown"

    # Description
    desc = response.css_first(".user-html")
    detail["description"] = desc.text[:500].strip() if desc else ""

    # Price
    price = response.css_first(".dollar-amount")
    detail["price"] = price.text.strip() if price else "N/A"

    # Rating
    rating = response.css_first(".star-rating__value")
    detail["rating"] = rating.text.strip() if rating else "N/A"

    # Sales count
    sales = response.css_first("[data-item-sales]")
    detail["sales"] = sales.attrib.get("data-item-sales", "N/A") if sales else "N/A"

    # Screenshots
    screenshots = response.css("img.js-item-gallery-image")
    detail["screenshots"] = [img.attrib.get("src", "") for img in screenshots[:10]]

    # Tags / tech stack
    tags = response.css(".meta-attributes__attr-detail a")
    detail["tags"] = [tag.text.strip() for tag in tags]

    # Compatible frameworks
    frameworks_section = response.css(".meta-attributes__attr-detail")
    detail["frameworks"] = []
    for section in frameworks_section:
        text = section.text.strip().lower()
        for fw in ["react", "vue", "angular", "tailwind", "bootstrap", "next.js", "typescript"]:
            if fw in text and fw not in detail["frameworks"]:
                detail["frameworks"].append(fw)

    # Demo URL
    demo_link = response.css_first("a.btn-icon--preview, a[data-preview-url]")
    detail["demo_url"] = demo_link.attrib.get("href", "") if demo_link else None

    # Last updated
    updated = response.css_first(".meta-attributes__attr-detail time")
    detail["last_updated"] = updated.attrib.get("datetime", "") if updated else None

    return detail


def build_catalog(top_n=20, frameworks=None):
    """
    Build a curated catalog of top-rated admin dashboard templates.
    Searches across multiple categories and frameworks.
    """
    catalog = load_catalog()

    searches = [
        {"query": "admin dashboard react", "framework": "react"},
        {"query": "admin dashboard tailwind", "framework": "tailwind"},
        {"query": "crm dashboard", "framework": None},
        {"query": "project management dashboard", "framework": None},
        {"query": "analytics dashboard dark theme", "framework": None},
        {"query": "construction management dashboard", "framework": None},
    ]

    if frameworks:
        searches = [s for s in searches if not s["framework"] or s["framework"] in frameworks]

    all_results = []

    for search in searches:
        print(f"\n[+] Searching: {search['query']}")
        results = search_themeforest(
            query=search["query"],
            framework=search.get("framework"),
            max_pages=2
        )
        all_results.extend(results)
        print(f"  -> Found {len(results)} templates")

    # Deduplicate by URL
    seen = set()
    unique = []
    for t in all_results:
        if t["url"] and t["url"] not in seen:
            seen.add(t["url"])
            unique.append(t)

    # Score and rank
    for t in unique:
        score = 0
        score += (t.get("rating", 0) or 0) * 20           # Rating weight
        score += min((t.get("sales", 0) or 0) / 100, 50)   # Sales weight (capped)
        score += 10 if t.get("price", 999) <= 59 else 0     # Price bonus
        t["halofire_score"] = round(score, 1)

    # Sort by score, take top N
    ranked = sorted(unique, key=lambda x: x["halofire_score"], reverse=True)[:top_n]

    catalog["templates"] = ranked
    catalog["sources"] = list(set(t["source"] for t in ranked))
    catalog["total_scraped"] = len(all_results)
    catalog["unique_count"] = len(unique)

    save_catalog(catalog)
    print(f"\n[✓] Catalog built: {len(ranked)} top templates saved to {CATALOG_FILE}")

    return catalog


def compare_templates(urls):
    """Compare multiple templates side by side."""
    comparisons = []
    for url in urls:
        detail = preview_template(url)
        comparisons.append(detail)

    return comparisons


def recommend_for_halofire():
    """
    Based on the catalog, recommend the best templates for HaloFire's needs:
    - Fire sprinkler company (construction/trades industry)
    - Needs: CRM, project management, estimating, compliance tracking
    - Must support React + Tailwind
    - Dark theme preferred (matches fire/ember branding)
    - Professional, minimal, data-heavy dashboards
    """
    catalog = load_catalog()

    if not catalog["templates"]:
        print("[!] No catalog data. Run: python scraper.py catalog first")
        return []

    # HaloFire-specific scoring criteria
    priority_tags = ["react", "tailwind", "dark", "crm", "project", "dashboard",
                     "construction", "analytics", "chart", "data"]

    recommendations = []
    for t in catalog["templates"]:
        bonus = 0
        tags = " ".join(t.get("tags", [])).lower()
        name = t.get("name", "").lower()

        for tag in priority_tags:
            if tag in tags or tag in name:
                bonus += 5

        t["halofire_fit_score"] = t.get("halofire_score", 0) + bonus
        recommendations.append(t)

    recommendations.sort(key=lambda x: x["halofire_fit_score"], reverse=True)

    print("\n  HALOFIRE UI TEMPLATE RECOMMENDATIONS")
    print("  " + "=" * 50)
    for i, t in enumerate(recommendations[:5], 1):
        print(f"\n  #{i} {t['name']}")
        print(f"     Price: ${t.get('price', 'N/A')} | Rating: {t.get('rating', 'N/A')} | Sales: {t.get('sales', 'N/A')}")
        print(f"     Score: {t['halofire_fit_score']}")
        print(f"     URL: {t.get('url', 'N/A')}")

    return recommendations[:5]


# --- CLI ---
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="HaloFire UI Template Scraper")
    sub = parser.add_subparsers(dest="command")

    # Search
    search_p = sub.add_parser("search", help="Search for templates")
    search_p.add_argument("--query", default="admin dashboard", help="Search query")
    search_p.add_argument("--framework", default=None, help="Framework filter")
    search_p.add_argument("--min-rating", type=float, default=4.0)
    search_p.add_argument("--max-price", type=float, default=100)
    search_p.add_argument("--pages", type=int, default=2)

    # Catalog
    cat_p = sub.add_parser("catalog", help="Build template catalog")
    cat_p.add_argument("--top", type=int, default=20)

    # Preview
    prev_p = sub.add_parser("preview", help="Preview a template")
    prev_p.add_argument("--url", required=True)

    # Recommend
    sub.add_parser("recommend", help="Get HaloFire-specific recommendations")

    args = parser.parse_args()

    if not ensure_scrapling():
        sys.exit(1)

    if args.command == "search":
        results = search_themeforest(args.query, args.framework, args.min_rating, args.max_price, max_pages=args.pages)
        print(json.dumps(results, indent=2))
    elif args.command == "catalog":
        build_catalog(args.top)
    elif args.command == "preview":
        detail = preview_template(args.url)
        print(json.dumps(detail, indent=2))
    elif args.command == "recommend":
        recommend_for_halofire()
    else:
        parser.print_help()
