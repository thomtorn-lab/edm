import { describe,it,expect } from "vitest";
import { buildQaInputs,technicalFindings,type QaSnapshot } from "./qaSnapshotEnrichment";
const event={id:"e1",title:"Electronic Night",artists:["DJ A"],venue_id:"v1",start_datetime:"2026-11-01T21:00:00Z",primary_genre:"Techno",subgenres:["Techno"],official_event_url:"https://example.org/e1",ticket_url:"https://example.org/ticket"};
const base:QaSnapshot={generated_at:"2026-10-29T04:00:00Z",events:[event],source_event_links:[],event_change_log:[],sources:[],discovery_queue:[]};
const find=(s:QaSnapshot,c:string)=>buildQaInputs(s).find(x=>x.subject_id==="e1"&&x.category===c)?.source_fingerprint;
describe("QA snapshot category fingerprints",()=>{
  it("covers every event category and global categories",()=>{
    const a=buildQaInputs(base);expect(a.filter(x=>x.subject_id==="e1")).toHaveLength(4);
    expect(a.some(x=>x.category==="about_language")).toBe(true);
    expect(a.some(x=>x.category==="production_technical")).toBe(true);
    expect(a.some(x=>x.category==="discovery")).toBe(true);
  });
  it("does not invalidate genre when only ticket URL changes",()=>{
    const changed={...base,events:[{...event,ticket_url:"https://example.org/other"}]};
    expect(find(changed,"music_genre")).toBe(find(base,"music_genre"));
    expect(find(changed,"links")).not.toBe(find(base,"links"));
  });
  it("invalidates genre when artists change",()=>{
    const changed={...base,events:[{...event,artists:["DJ B"]}]};
    expect(find(changed,"music_genre")).not.toBe(find(base,"music_genre"));
  });
  it("does not invalidate facts from unrelated change log append",()=>{
    const changed={...base,event_change_log:[{id:"c1",event_id:"e1",fields_changed:["description"]}]};
    expect(find(changed,"source_facts")).toBe(find(base,"source_facts"));
  });
  it("reuses duplicate assessment and reports missing fields as signals",()=>{
    const findings=technicalFindings({...base,events:[event,{...event,id:"e2"}]});
    expect(findings.duplicate_candidates.length).toBeGreaterThan(0);
    expect(findings.data_quality).toEqual([]);
  });
});
