# Electronic CPH — iPhone prototype (Expo)

A native React Native/Expo app on top of the existing website. It has no data
of its own: every event comes from the website's public, read-only
`GET /api/v1/events` (`src/app/api/v1/events/route.ts`), which reads the same
published-and-upcoming events as the homepage. Unpublishing or editing an
event on the site reaches the app on its next refresh (on launch,
pull-to-refresh, or returning to the app after a minute; the CDN may reuse a
response for up to 60 s).

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

## Try it on an iPhone (Expo Go)

1. Install **Expo Go** from the App Store on the iPhone.
2. On a computer with Node 20+:
   ```bash
   git fetch origin claude/electroniccph-ios-app-fyf9q2
   git checkout claude/electroniccph-ios-app-fyf9q2
   cd mobile
   npm ci
   ```
3. Point the app at a deployment that has `/api/v1/events`. Until this is
   merged that is the branch's Vercel **Preview** deployment, which is behind
   Vercel Deployment Protection, so also give it the project's
   "Protection Bypass for Automation" secret. Create `mobile/.env.local`
   (git-ignored, never commit it):
   ```bash
   EXPO_PUBLIC_API_URL=https://<preview-deployment>.vercel.app
   EXPO_PUBLIC_VERCEL_BYPASS=<protection bypass secret>
   ```
   Without `.env.local` the app uses https://www.electroniccph.com.
4. `npx expo start` and scan the QR code with the iPhone camera. If the phone
   and computer are not on the same network, use `npx expo start --tunnel`.

## Checks

```bash
npm run typecheck
npx expo export --platform ios   # bundles the app, including the shared files
```
