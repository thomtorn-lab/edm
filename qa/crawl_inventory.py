#!/usr/bin/env python3
"""Deterministic read-only QA evidence collector; editorial verification remains separate."""
import json, re, urllib.request, urllib.parse, xml.etree.ElementTree as ET
from datetime import datetime, timezone
from html.parser import HTMLParser
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import defaultdict
from pathlib import Path
BASE="https://www.electroniccph.com"
HEADERS={"User-Agent":"ElectronicCPH-QA/1.0 (read-only)"}
class PageParser(HTMLParser):
    def __init__(self):
        super().__init__(); self.links=[]; self.title=""; self.in_title=False; self.canonical=None; self.metadata={}; self.anchors=[]; self.active_anchor=None
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag=="a" and a.get("href"):
            self.links.append(a["href"])
            self.active_anchor={"href":a["href"],"text":""}
        if tag=="title": self.in_title=True
        if tag=="link" and a.get("rel")=="canonical": self.canonical=a.get("href")
        if tag=="meta" and a.get("property") in ("og:title","og:url","og:type"): self.metadata[a["property"]]=a.get("content")
    def handle_endtag(self,tag):
        if tag=="title": self.in_title=False
        if tag=="a" and self.active_anchor is not None:
            self.anchors.append(self.active_anchor); self.active_anchor=None
    def handle_data(self,data):
        if self.in_title: self.title+=data
        if self.active_anchor is not None: self.active_anchor["text"]+=data
def fetch(url):
    req=urllib.request.Request(url,headers=HEADERS)
    with urllib.request.urlopen(req,timeout=25) as response:
        return {"status":response.status,"final_url":response.url,"html":response.read(3000000).decode("utf-8","replace")}
def sitemap_urls(url,seen=None):
    if seen is None: seen=set()
    if url in seen: return []
    seen.add(url)
    root=ET.fromstring(fetch(url)["html"])
    locs=[node.text for node in root.iter() if node.tag.rsplit("}",1)[-1]=="loc" and node.text]
    if root.tag.rsplit("}",1)[-1]=="sitemapindex":
        found=[]
        for loc in locs: found+=sitemap_urls(loc,seen)
        return found
    return locs
def normalized_url(url):
    p=urllib.parse.urlsplit(url)
    return (p.netloc.lower()+p.path.rstrip("/")).lower()
def is_event_url(url):
    return bool(re.search(r"/events?/",urllib.parse.urlsplit(url).path))
def inspect(url):
    page=fetch(url); parser=PageParser(); parser.feed(page["html"])
    links=sorted(set(urllib.parse.urljoin(url,l) for l in parser.links if l.startswith(("http://","https://","/"))))
    return {"url":url,"status":page["status"],"final_url":page["final_url"],"title":parser.title.strip(),"canonical":parser.canonical,"metadata":parser.metadata,"outbound_links":links,"action_links":[{"label":a["text"].strip(),"url":urllib.parse.urljoin(url,a["href"])} for a in parser.anchors if re.search(r"ticket|billet|official event",a["text"],re.I)]}
def validate_register(obj):
    if not isinstance(obj,dict) or obj.get("schema_version")!=1 or not isinstance(obj.get("issues"),list): raise ValueError("Invalid QA register schema")
    ids=[x.get("id") for x in obj["issues"]]
    if any(not isinstance(i,str) or not i for i in ids) or len(ids)!=len(set(ids)): raise ValueError("Duplicate or missing issue ID")
    if any(x.get("status") not in ("open","resolved","historical_unverified") for x in obj["issues"]): raise ValueError("Invalid issue status")
    return True
def compare_with_register(findings,register):
    validate_register(register)
    previous={x["id"]:x for x in register["issues"]}
    delta=[]
    for item in findings:
        old=previous.get(item["id"])
        if old is None: delta.append({**item,"delta":"candidate_new_unverified"})
        elif old["status"]=="resolved": delta.append({**item,"delta":"candidate_reappeared_unverified"})
    return delta
def main():
    result={"started_at":datetime.now(timezone.utc).isoformat(),"scope":"sitemap-based technical inventory only; NOT complete editorial QA","pages":[],"errors":[],"findings":[],"manual_verification_required":["homepage inventory reconciliation","artist-by-artist external verification","official source and lineup comparison","genre accuracy","external discovery omissions","ticket and official link end-to-end verification"]}
    try: urls=sitemap_urls(BASE+"/sitemap.xml")
    except Exception as exc: result["errors"].append({"url":BASE+"/sitemap.xml","error":str(exc)});urls=[]
    events=sorted(set(u for u in urls if is_event_url(u)))
    result["sitemap_event_url_count"]=len(events)
    try:
        homepage=inspect(BASE+"/")
        home_events=sorted(set(u for u in homepage["outbound_links"] if is_event_url(u) and urllib.parse.urlsplit(u).netloc==urllib.parse.urlsplit(BASE).netloc))
        result["homepage_event_urls"]=home_events
        result["homepage_event_url_count"]=len(home_events)
        missing=sorted(set(normalized_url(u) for u in home_events)-set(normalized_url(u) for u in events))
        if missing: result["findings"].append({"type":"homepage_events_missing_from_sitemap","urls":missing,"verification":"technical"})
    except Exception as exc:
        result["errors"].append({"url":BASE+"/","error":str(exc)})
        result["homepage_event_url_count"]=None
    with ThreadPoolExecutor(max_workers=5) as pool:
        futures={pool.submit(inspect,url):url for url in events}
        for future in as_completed(futures):
            url=futures[future]
            try: result["pages"].append(future.result())
            except Exception as exc: result["errors"].append({"url":url,"error":str(exc)})
    result["pages"].sort(key=lambda x:x["url"])
    by_canonical=defaultdict(list)
    for p in result["pages"]:
        if not p["title"]: result["findings"].append({"type":"missing_title","url":p["url"],"verification":"technical"})
        if p["canonical"] and normalized_url(p["canonical"])!=normalized_url(p["url"]):
            result["findings"].append({"type":"canonical_mismatch_candidate","url":p["url"],"canonical":p["canonical"],"verification":"manual"})
        by_canonical[normalized_url(p["canonical"] or p["url"])].append(p["url"])
    for canonical,matches in by_canonical.items():
        if len(matches)>1: result["findings"].append({"type":"duplicate_canonical_candidate","urls":matches,"verification":"manual"})
    register_path=Path("qa/electroniccph-issues.json")
    try:
        register=json.loads(register_path.read_text(encoding="utf-8"))
        validate_register(register)
        result["register_read_validated"]=True
        result["register_issue_count"]=len(register["issues"])
        result["register_modified"]=False
        result["historical_issue_statuses"]={s:sum(x["status"]==s for x in register["issues"]) for s in ("open","resolved","historical_unverified")}
    except Exception as exc:
        result["register_read_validated"]=False
        result["errors"].append({"url":str(register_path),"error":str(exc)})
    result["finished_at"]=datetime.now(timezone.utc).isoformat()
    result["technical_inventory_complete"]=bool(events) and not result["errors"] and len(result["pages"])==len(events) and result["homepage_event_url_count"] is not None
    result["full_qa_complete"]=False
    with open("qa-inventory.json","w",encoding="utf-8") as out: json.dump(result,out,indent=2,ensure_ascii=False)
    print("Detail URLs:",len(events),"Fetched:",len(result["pages"]),"Errors:",len(result["errors"]),"Candidates:",len(result["findings"]))
    if not result["technical_inventory_complete"]: raise SystemExit(1)
if __name__=="__main__": main()
