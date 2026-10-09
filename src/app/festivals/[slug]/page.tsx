import { permanentRedirect } from "next/navigation";

// Festival detail pages added no information beyond /festivals itself —
// festival entries now link straight to the official festival site instead.
// This route stays only so any old/bookmarked/indexed /festivals/[slug] URL
// lands somewhere sensible rather than 404ing. Permanent (308), since the
// detail pages are gone for good — search engines should drop the old URLs.
export default async function FestivalDetailPage() {
  permanentRedirect("/festivals");
}
