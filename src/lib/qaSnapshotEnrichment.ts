/** Deterministic QA signals. Reuses the site's existing dedup and source-health engines. */
import { assessDuplicate, type DuplicateCandidate } from "./dedup";
import { getSourceHealth } from "./sourceHealth";
import type { Source } from "./types";
import { fingerprint, QA_CATEGORIES, type QaInput } from "./qaStatus";

type Row=Record<string,unknown>;
export type QaSnapshot = {
  generated_at:string; events:Row[]; source_event_links:Row[];
  event_change_log:Row[]; sources:Row[]; discovery_queue:Row[];
};
const str=(x:unknown)=>x===null||x===undefined?"":String(x);
const arr=(x:unknown):string[]=>Array.isArray(x)?x.map(str):[];
const date=(x:unknown)=>x instanceof Date?x.toISOString():str(x);
function candidate(e:Row):DuplicateCandidate {
  return {title:str(e.title),artists:arr(e.artists),venueId:str(e.venue_id)||null,
    startDatetime:date(e.start_datetime),subVenue:str(e.sub_venue)||null,
    sourceId:str(e.canonical_source_id)||null,
    officialEventUrl:str(e.official_event_url)||null,
    ticketUrl:str(e.ticket_url)||null,
    residentAdvisorUrl:str(e.resident_advisor_url)||null};
}
export function technicalFindings(s:QaSnapshot) {
  const duplicate_candidates:{a:string;b:string;confidence:string;reasons:string[]}[]=[];
  for(let i=0;i<s.events.length;i++) for(let j=i+1;j<s.events.length;j++) {
    const a=s.events[i],b=s.events[j];
    const assessment=assessDuplicate(candidate(a),candidate(b));
    if(assessment.confidence!=="none")
      duplicate_candidates.push({a:str(a.id),b:str(b.id),confidence:assessment.confidence,reasons:assessment.reasons});
  }
  const source_health=s.sources.map(source=>({
    source_id:str(source.id),
    health:getSourceHealth({
      id:str(source.id),active:source.active===true,adapter:source.adapter?str(source.adapter):null,
      lastError:source.last_error?str(source.last_error):null,
      lastSuccessfulSync:source.last_successful_sync?date(source.last_successful_sync):null,
      eventsFound:Number(source.events_found??0),
      syncFrequency:str(source.sync_frequency)
    } as Source,new Date(s.generated_at))
  }));
  const data_quality=s.events.flatMap(e=>{
    const problems:string[]=[];
    if(!arr(e.artists).length) problems.push("missing_lineup");
    if(!str(e.official_event_url)) problems.push("missing_official_url");
    if(!str(e.primary_genre)) problems.push("missing_primary_genre");
    if(arr(e.subgenres).length>2) problems.push("more_than_two_genres");
    if(!str(e.venue_id)) problems.push("missing_venue");
    if(!str(e.ticket_url)) problems.push("missing_ticket_url_review"); // not automatically an error
    return problems.length?[{event_id:str(e.id),flags:problems}]:[];
  });
  return {duplicate_candidates,source_health,data_quality};
}
/** Every event gets all event-scoped categories, plus global ABOUT/technical/discovery checks.
 * Source sync timestamps do NOT themselves invalidate a verified fact unless material changed.
 * Human verification expires via next_check_at independently.
 */
export function buildQaInputs(s:QaSnapshot):QaInput[] {
  const links=new Map<string,Row[]>();
  for(const l of s.source_event_links) {
    const id=str(l.event_id);links.set(id,[...(links.get(id)??[]),l]);
  }
  const result:QaInput[]=[];
  const add=(id:string,category:QaInput["category"],value:unknown)=>result.push({
    subject_id:id,category,source_fingerprint:fingerprint(value)});
  for(const e of s.events) {
    const id=str(e.id), l=links.get(id)??[];
    // Changes are exported for evidence, but timestamps/history alone do not reopen checks.
    // Reopen only when the current category-specific material actually changes.
    add(id,"source_facts",{title:e.title,artists:e.artists,start:e.start_datetime,venue:e.venue_id,
      room:e.sub_venue,cancelled:e.cancelled,postponed:e.postponed,sold_out:e.sold_out,
      source_links:l.filter(x=>x.role==="official").map(x=>[x.source_id,x.source_url])});
    add(id,"music_genre",{artists:e.artists,title:e.title,primary:e.primary_genre,
      subgenres:e.subgenres,confidence:e.genre_confidence});
    add(id,"links",{official:e.official_event_url,ticket:e.ticket_url,ra:e.resident_advisor_url,
      facebook:e.facebook_url,source_links:l.map(x=>[x.source_id,x.source_url,x.role])});
    add(id,"duplicates",{title:e.title,artists:e.artists,venue:e.venue_id,room:e.sub_venue,
      start:e.start_datetime,official:e.official_event_url,ticket:e.ticket_url});
  }
  add("site:discovery","discovery",s.discovery_queue.map(x=>[
    x.id,x.status,x.source_url,x.probable_start,x.predicted_genre,x.detected_lineup]));
  add("site:about","about_language",{policy:"manual-english-about-review-v1"});
  add("site:technical","production_technical",{policy:"manual-production-genre-ui-and-vercel-v1"});
  // Source-health changes trigger discovery re-evaluation, not all event categories.
  const health=technicalFindings(s).source_health;
  add("site:sources","discovery",health);
  return result;
}
