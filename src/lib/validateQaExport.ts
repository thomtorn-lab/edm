import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const path=process.argv[2] || "qa-output/qa-snapshot.json";
const x=JSON.parse(readFileSync(path,"utf8"));
assert.equal(x.schema_version,1);
assert.equal(x.scope,"published_upcoming_events");
assert.ok(Number.isFinite(Date.parse(x.generated_at)));
for(const k of ["events","source_event_links","event_change_log","sources","discovery_queue","qa_inputs"])
 assert.ok(Array.isArray(x[k]),"Missing array "+k);
for(const k of ["duplicate_candidates","source_health","data_quality"])
 assert.ok(Array.isArray(x.technical_findings?.[k]),"Missing technical signal "+k);
assert.equal(x.counts.events,x.events.length);
assert.equal(x.counts.source_links,x.source_event_links.length);
assert.equal(x.counts.change_log,x.event_change_log.length);
assert.equal(x.counts.sources,x.sources.length);
assert.equal(x.counts.discovery_candidates,x.discovery_queue.length);
const ids=new Set<string>();
for(const e of x.events) {
 assert.ok(typeof e.id==="string" && e.id);
 assert.ok(!ids.has(e.id),"Duplicate event id");
 ids.add(e.id);
 assert.ok(e.start_datetime && Date.parse(e.start_datetime)>=Date.parse(x.generated_at),"Expired event");
 assert.ok(e.venue_id && e.venue_name,"Missing venue relation");
 for(const category of ["source_facts","music_genre","links","duplicates"])
   assert.equal(x.qa_inputs.filter((c:{subject_id:string;category:string})=>c.subject_id===e.id&&c.category===category).length,1,"Missing event QA category");
}
for(const l of x.source_event_links) assert.ok(ids.has(l.event_id),"Orphan source link");
for(const c of x.event_change_log) assert.ok(ids.has(c.event_id),"Orphan change log");
for(const category of ["discovery","about_language","production_technical"])
 assert.ok(x.qa_inputs.some((c:{category:string})=>c.category===category),"Missing site QA category");
console.log(JSON.stringify({result:"pass",counts:x.counts,qa_checks:x.qa_inputs.length,technical:{
 duplicates:x.technical_findings.duplicate_candidates.length,
 source_health:x.technical_findings.source_health.length,
 data_quality:x.technical_findings.data_quality.length}}));
