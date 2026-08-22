import { redirect } from "next/navigation";

// Festival detail pages added no information beyond /festivals itself —
// festival entries now link straight to the official festival site instead.
// This route stays only so any old/bookmarked/indexed /festivals/[slug] URL
// lands somewhere sensible rather than 404ing.
export default async function FestivalDetailPage() {
  redirect("/festivals");
}
