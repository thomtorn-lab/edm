#!/usr/bin/env python3
"""Read-only ElectronicCPH crawl inventory. NOT a complete editorial QA."""
import json, re, urllib.request, urllib.parse, xml.etree.ElementTree as ET
from datetime import datetime, timezone
from html.parser import HTMLParser

BASE = "https://www.electroniccph.com"
UA = {"User-Agent": "ElectronicCPH-QA/1.0 (+read-only monitoring)"}
class Links(HTMLParser):
    def __init__(self):
        super().__init__(); self.links = []
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "a" and a.get("href"): self.links.append(a["href"])
def fetch(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=25) as r:
        body = r.read(3000000)
        return {"status": r.status, "final_url": r.url, "html": body.decode("utf-8", "replace")}
def sitemap_urls(url, seen=None):
    seen = seen or set()
    if url in seen: return []
    seen.add(url)
    raw = fetch(url)["html"]
    root = ET.fromstring(raw)
    locs = [n.text for n in root.iter() if n.tag.endswith("}loc") and n.text]
    if root.tag.endswith("sitemapindex"):
        result = []
        for loc in locs: result.extend(sitemap_urls(loc, seen))
        return result
    return locs
def main():
    result = {"started_at": datetime.now(timezone.utc).isoformat(), "scope": "read-only sitemap inventory and detail-link crawl; not full QA", "pages": [], "errors": []}
    try: urls = sitemap_urls(BASE + "/sitemap.xml")
    except Exception as exc:
        result["errors"].append({"url": BASE + "/sitemap.xml", "error": str(exc)}); urls = []
    event_urls = sorted(set(u for u in urls if re.search(r"/events?/", urllib.parse.urlparse(u).path)))
    result["sitemap_event_url_count"] = len(event_urls)
    for url in event_urls:
        try:
            p = fetch(url); parser = Links(); parser.feed(p["html"])
            links = sorted(set(urllib.parse.urljoin(url, x) for x in parser.links if x.startswith(("http", "/"))))
            result["pages"].append({"url": url, "status": p["status"], "final_url": p["final_url"], "outbound_links": links})
        except Exception as exc: result["errors"].append({"url": url, "error": str(exc)})
    result["finished_at"] = datetime.now(timezone.utc).isoformat()
    result["complete_inventory"] = bool(event_urls) and not result["errors"]
    with open("qa-inventory.json", "w", encoding="utf-8") as f: json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"Event detail URLs: {len(event_urls)}; fetched: {len(result['pages'])}; errors: {len(result['errors'])}")
    if not result["complete_inventory"]: raise SystemExit(1)
if __name__ == "__main__": main()
