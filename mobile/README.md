# Electronic CPH — iPhone prototype (Expo)

A native React Native/Expo app on top of the existing website. It has no data
of its own: every event comes from the website's public, read-only
`GET /api/v1/events` (`src/app/api/v1/events/route.ts`), which reads the same
published-and-upcoming events as the homepage. The app holds no secrets —
anything in an `EXPO_PUBLIC_*` variable is readable in the app bundle.

Unpublished or edited events: Vercel's CDN reuses a response for at most 60 s
(`Cache-Control: public, max-age=0, s-maxage=60`, no stale-while-revalidate),
and the app re-fetches whenever its copy is older than 60 s (every minute while
open, on returning to the app, before showing an event's details) and on
pull-to-refresh. An unpublished event is gone from the app within about
2 minutes; once it is gone, its ticket links are hidden.

Shared with the website, unchanged: `src/lib/datetime.ts` (nightlife day,
Tonight/This Weekend), `src/lib/format.ts` (date/time labels),
`src/lib/taxonomy.ts` (genres and genre filter matching) and the response
type in `src/lib/appEvents.ts`. `metro.config.js` lets Metro read `../src/lib`;
nothing else outside `mobile/` is used.

V1 scope: event list (Tonight / This Weekend / Upcoming), genre and venue
filters, event details (date, time, lineup, venue, genres), Tickets/Official
event links, saved events (stored only on the phone), native navigation and
sharing.

The website build ignores this folder (`tsconfig.json` exclude, `eslint.config.mjs`
ignore, `.vercelignore`).

## Try it on an iPhone (Expo Go, no computer needed)

The app always talks to the public website, by default
https://www.electroniccph.com, so `/api/v1/events` must be deployed there
first. `EXPO_PUBLIC_API_URL` can point at another public deployment; never
put a token or secret in it.

1. Install **Expo Go** from the App Store and sign in with an Expo account.
2. Publish the app's JavaScript as an EAS Update (`npx eas-cli@latest update`,
   with `EXPO_TOKEN` set for that Expo account).
3. Open the update in Expo Go from the project's Updates page on expo.dev, or
   by scanning its QR code with the iPhone camera.

With a computer instead: `npm ci && npx expo start` in `mobile/`, then scan the
QR code with the iPhone camera.

## Checks

```bash
npm run typecheck
npx expo export --platform ios   # bundles the app, including the shared files
```
