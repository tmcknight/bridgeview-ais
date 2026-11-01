# Claude Instructions for BridgeView AIS

## Project Overview

BridgeView AIS is a real-time maritime tracking application that visualizes vessel traffic near the Blue Water Bridge using AIS (Automatic Identification System) data. The app streams live ship positions via WebSocket and displays them on an interactive map with detailed vessel information.

## Tech Stack

- **Framework**: React 19 + TypeScript
- **Build Tool**: Vite with HMR
- **Mapping**: MapLibre GL JS via react-map-gl for interactive visualization
- **Styling**: Tailwind CSS 4.x (using @tailwindcss/vite plugin)
- **UI Components**: Headless UI + Heroicons for accessible, unstyled components
- **WebSocket Server**: Node.js with ws library
- **Data Source**: Real-time AIS data from AISStream.io

## Architecture

### Frontend Structure

```
src/
├── components/         # React components
│   ├── ShipMap.tsx    # MapLibre GL map with vessel markers (via react-map-gl)
│   ├── MovingMarker.tsx # Map marker that glides between position reports
│   ├── ShipList.tsx   # List view of tracked vessels
│   ├── NotificationPanel.tsx  # Real-time alerts
│   ├── UpcomingShips.tsx      # "Coming up" list of ships heading for the bridge
│   ├── ShipLog.tsx    # Log of ships that have gone under the bridge
│   ├── StatusBar.tsx  # One status for the connection and every feed, with a dropdown of each
│   ├── PhotoCarousel.tsx # A ship's Commons photos, one at a time, with credits
│   ├── SourceBadge.tsx # Where a ship's last position came from (antenna, AISStream, AISHub)
│   ├── DataCredits.tsx # Data credits the feeds' terms require, always shown in the map's corner
│   ├── ShipCam.tsx    # Port Huron YouTube ship cams, toggled from the header
│   ├── TvMode.tsx     # TV mode: full-screen cam and ship details while a ship goes by
│   ├── ErrorBoundary.tsx          # App-level error boundary
│   └── ComponentErrorBoundary.tsx # Component-level error boundary
├── hooks/
│   ├── useAISStream.ts  # WebSocket connection management
│   ├── useIdle.ts       # Whether the mouse has been still (TV mode hides its buttons)
│   ├── useLiveStream.ts # Keeps a YouTube cam at the live edge (plays again if paused or behind)
│   └── useTheme.ts      # Dark/light theme toggle
├── types/
│   └── ais.ts         # AIS data type definitions
├── constants/
│   ├── bridge.ts      # Blue Water Bridge location data
│   └── shipCams.ts    # Ship cam list (YouTube video IDs)
├── utils/
│   ├── geo.ts         # Geographic calculations (distance, bearing, etc.)
│   ├── upcoming.ts    # Ships heading for the bridge, with rough ETAs
│   ├── cargo.ts       # Cargo guesses from AIS destination ports (cargo ships and tankers of 100 m+)
│   ├── shipLog.ts     # Ship log types and server message handling
│   ├── feedStatus.ts  # Feed health types and server message handling
│   ├── aircraft.ts    # Aircraft server messages and display helpers
│   ├── shipCams.ts    # Ship cam video IDs from the server
│   ├── motion.ts      # Dead reckoning and easing between position reports
│   ├── tvMode.ts      # Which ship TV mode shows on the cam
│   └── logger.ts      # Logging utility
├── test/              # Test infrastructure
│   ├── setup.ts       # Vitest setup
│   ├── mocks/         # Mock data factories (ships, AIS messages, WebSocket)
│   └── utils/         # Test utilities (renderWithProviders)
├── App.tsx            # Main app component
├── main.tsx           # Entry point
└── index.css          # Global styles
```

### Backend

- `server/server.js`: Secure WebSocket proxy server that connects to AISStream.io and relays messages to clients
  - Rate limiting (20 connections per IP by default, 60 messages per minute); a 30s ping drops dead connections
  - Optional authentication token support
  - Input validation and bounding box size limits
  - Subscription timeout protection
- `server/upstream.js`: One AISStream.io connection shared by all clients (AISStream allows only 3 per account/IP)
  - Subscribes to the union of every client's area, re-subscribing at most once a second; the server filters messages per client
- `server/ship-log.js`: Shared log of ships passing under the bridge
  - Fed by the server's own AIS connection, so passages are logged with no browser open
  - Saved to `SHIP_LOG_FILE` (default `data/ship-log.json`; Docker `ship-log` volume)
  - Sends `{type: "shipLog", entries}` on subscribe and `{type: "shipLogEntry", entry}` on each change
- `server/vessel-details.js`: Each ship's latest details from either feed, stored in SQLite (`node:sqlite`) at `DB_FILE` (default `data/bridgeview.db`; Docker `ship-log` volume)
  - Also looks each ship up on Wikidata (`server/wikidata.js`; photo link, build year, operator) and stores the result; `VESSEL_INFO_LOOKUP=false` turns this off
  - Sends a ship's stored details and `{type: "vesselInfo", mmsi, info}` to a client just before its first position, and new lookups as they finish; fills in names on antenna reports
- `server/vessel-registry.js`: Transport Canada's register of large vessels (open data XLSX, read with no dependencies), imported weekly into `DB_FILE` and keyed by IMO number; `VESSEL_REGISTRY=false` turns it off
  - Attached to a ship's details as `info.registry` (port of registry, official number, size, engine power) when they're read; ships Wikidata doesn't know get details from the registers alone
- `server/uscg-psix.js`: USCG PSIX lookup (SOAP; service type, flag, gross tonnage, deadweight, and inspections over 3 years with deficiencies and operational controls for the latest 5) for US ships (by call sign) and foreign ships that call at US ports (by IMO number); `USCG_LOOKUP=false` turns it off
- `server/commons.js`: Up to 12 ship photos from Wikimedia Commons (the `IMO nnnnnnn` category, its ship subcategories and Wikidata's Commons category), Wikidata's photo first, each with artist and licence (`info.photos`); stepped through with arrows on the ship card, swiped on iOS (round from the last back to the first; tap for full screen with pinch to zoom, `ios/BridgeView/Views/PhotoPager.swift`), and rotated every 8s in TV mode (`PhotoCarousel.tsx`)
- `server/vessel-info.js`: Combines the per-ship lookups (Wikidata, `info.uscg`, `info.photos`) into what's stored, and fills in build year and gross tonnage from the registers (Wikidata first, then Transport Canada, then the USCG)
- `server/admin-api.js`: Password-protected ship data admin (`/admin`, `admin.html` + `src/admin/`; not linked from anywhere, `noindex`); off unless `ADMIN_PASSWORD` is set
  - Login gives a 12 h bearer token (in memory; login attempts rate-limited per IP); search ships (by name, MMSI, IMO or call sign, and type; 50 at a time with the total, a photo icon on ships with photos), correct details, look a ship up again now, and add (upload or link), hide, reorder or remove photos
  - Corrections (`server/vessel-overrides.js`) are stored apart from lookups in `DB_FILE` and applied last, so they survive later lookups; uploads go to a Cloudflare R2 bucket when `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` and `PHOTOS_PUBLIC_URL` are set (`server/photo-store.js`; S3 API signed with SigV4, no SDK), else to `PHOTOS_DIR` (default `photos/` next to `DB_FILE`), served from `/api/photos/` (made absolute for the iOS app)
- `server/photo-submissions.js`: Ship photos shared from the iOS app (`POST /api/ships/:mmsi/photos`, handled by `server/admin-api.js`; whole JPEGs only (`inspectJpeg` in `server/photo-store.js`), 640 px to 8192 px, EXIF and anything after the picture stripped, the same file refused twice by SHA-256, 10 an hour per IP), stored in R2 under `shared/` and queued in SQLite at `DB_FILE` until approved on the admin page's "Shared photos" tab (`src/admin/PhotoQueue.tsx`); on only when `ADMIN_PASSWORD` and R2 are both set up (`/api/bridge` says so with `photoSharing`)
  - Approving adds it as the ship's first added photo, credited to the optional name given ("Used with permission"; the sharer keeps the copyright and licenses it, see `public/terms.html`); rejecting deletes it
  - `server/photo-reports.js`: "Report this photo" on a ship's page in the iOS app (`POST /api/ships/:mmsi/photos/report`, any of the ship's photos, with a reason; 20 an hour per IP, one per photo per device) queues it for the same tab, where it's hidden (removed if it was added by hand) or kept; on when `ADMIN_PASSWORD` is set (`photoReporting`)
  - Senders can be banned: by the app's random keychain ID (`X-BridgeView-Device`) for good and by HMAC-hashed IP for 30 days; banning rejects everything waiting from them
- `server/latest-positions.js`: Each ship's latest position report (in memory, dropped after 10 minutes unheard)
  - Replayed to a client on subscribe, so the map fills in at once instead of waiting for each ship's next report
- `server/feed-status.js`: Health of each configured feed (AISStream, local antenna, AISHub)
  - `connecting`, `live`, `quiet` (link up, no messages lately) or `down` (with the reason)
  - Sends `{type: "feedStatus", feeds}` on subscribe and whenever a feed's status changes, each with its web page `url` if it has one (`LOCAL_AIS_WEB_URL` for the antenna)
  - Summed up in one top-bar status (`StatusBar.tsx`: Live, "2 sources down", or the connection's own state), opening to the server connection and each feed's status, reason and link
- `server/local-receiver.js`: Optional local SDR source; reads AIS-catcher's TCP JSON stream and converts it to AISStream message shape
  - `AIS_SOURCES`: comma-separated `aisstream`, `local`, `aishub` (default `aisstream,local`; duplicates dropped per client). The old `AIS_SOURCE=aisstream|local|both` still works, with a warning
- `server/aishub.js`: Optional AISHub source; polls its REST API once a minute (its limit) for one box covering the ship log and every client's area
  - Converts each record to `ShipStaticData` (when details change) and `PositionReport` (when newer than any feed's latest); messages carry `MetaData.Source = "aishub"`
  - Reported as the `aishub` feed in feed status; needs `AISHUB_API_KEY` (AISHub's docs call it a username)
  - AISHub's terms: show "Data: AISHub contributors" linked to aishub.net clearly visible near the data (the map shows it whenever the feed is in use; the iOS app shows the server's `attribution`), and never pass on its raw data (positions, live or historical), so the open iOS API leaves out positions that came from AISHub
- `server/aircraft.js`: Aircraft layer; polls an ADS-B feed every 5s, backing off on errors (doubling, honouring a 429's `Retry-After`, capped at 5 min; default adsb.fi's free open-data API, 40 NM around the bridge; or a local readsb/tar1090 `aircraft.json` via `ADSB_URL`)
  - Sends `{type: "aircraft", aircraft}` on subscribe and after each poll; reported as the `adsb` feed in feed status; `AIRCRAFT_TRACKING=false` turns it off
  - adsb.fi's open data terms ask for a credit linked to adsb.fi: when `ADSB_URL` is adsb.fi's, the feed's status links to its map, and the map shows an "adsb.fi" credit while planes are shown
  - Shown on the map as amber planes (helicopters, ADS-B category A7, get their own icon), hideable with the map's plane button; in 3D, as plane or helicopter models sized by category, flying at their altitude above the river with a shadow below (`utils/aircraftModel.ts`)
- `server/ship-cams.js`: Follows each ship cam's live YouTube video when its stream restarts with a new ID (`YOUTUBE_API_KEY`, YouTube Data API)
  - Checks the current video is still live every 5 min (1 quota unit); only when it isn't, searches the cam's channel for a live video whose title matches (100 units, at most every 20 min)
  - Sends `{type: "shipCams", videoIds}` on subscribe and when one changes; without a key the cam uses the ID in `src/constants/shipCams.ts`
- `server/class-b.js`: Class B transponders (pleasure craft, small workboats) send messages 18/19/24; both feeds turn them into `PositionReport`/`ShipStaticData` with `MetaData.AisClass = "B"`
  - Shown on the map (hideable with the map's "B" button) and in the lists, but left out of the ship log and of bridge alerts (browser and vessel-notifier)
- `server/bridge-api.js`: HTTP API for the iOS app on the same port as the WebSocket (nginx proxies `/api/`); contract in `ios/API.md`
  - `GET /api/bridge` (ships coming up within 3 h and passed in the last 24 h, plus `attribution`: credits for the AIS feeds in `AIS_SOURCES`), `GET /api/ships/:mmsi`, `GET /api/map` (every ship heard lately, for the app's map; leaves out ships placed by AISHub), `PUT`/`DELETE /api/devices/:token`; open (the app can't keep a secret), rate-limited per IP
  - `?v=2` sends `info` for ships only the registers know (no `wikidataId`); older app builds, which need it, get Wikidata-backed `info` only
  - Leaves out USCG inspection history (`info.uscg.inspections`): shown on the web map only
  - Ships whose latest position came from AISHub are sent without `position` (its terms forbid passing on raw data); their `approach` (ETA, distance, direction) is still sent. Alerts use the full position internally
  - ETAs, ship categories, cargo guesses and flags in `server/bridge-eta.js` (mirrors `src/utils/upcoming.ts` and `src/utils/cargo.ts`)
- `server/approach-alerts.js`: iOS bridge alerts when a ship's ETA falls to 10 min (not under 3, at 2 kn or more), once per ship per 45 min, to devices whose settings match (category, minimum length, direction)
  - Live Activity or plain notification per the device's default, overridden per ship by `liveActivityShips` (a ship turned on is alerted even if its settings wouldn't match)
  - Devices with Live Activities get one started by push-to-start on a broadcast channel opened for that ship, updated as the ETA moves and ended when the ship log records the passage (or after 30 min); others get a time-sensitive notification
  - APNs client in `server/apns.js` (token auth, HTTP/2, no dependencies); devices and open channels in SQLite (`server/push-devices.js`, `DB_FILE`). Off unless `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID` and `APNS_KEY` (or `APNS_KEY_FILE`) are set

### iOS App

- `ios/`: SwiftUI app (iOS 18+) with a Live Activity widget extension; Xcode project generated by XcodeGen from `ios/project.yml`. See [ios/README.md](ios/README.md)
- The app's maps move ships like the web map: dead-reckoned between polls, redrawn at 30 fps while any ship moves, and eased onto each new report over 2s, heading included (`ios/BridgeView/Models/ShipMotion.swift`)
- iPhone Duo: runs on both displays, portrait and landscape; layout goes by size class (tabs can become a sidebar on the inner display, content kept to `readableWidth()`); full screen needs the iOS 27.1 SDK (Xcode 27.1), which the release workflow picks when the runner has it. See ios/README.md, iPhone Duo
- Releases: a GitHub release tagged `ios-vX.Y.Z` runs `.github/workflows/ios-release.yml`, which builds, signs and uploads to TestFlight (`ios/scripts/testflight.js`) and adds the build to the `IOS_BETA_GROUP` groups (comma-separated); see ios/README.md, Releases

### Vessel Notification Service

```
services/vessel-notifier/
├── src/
│   ├── index.ts              # Entry point with env config
│   ├── notifier.ts           # Main service (WebSocket client, orchestration)
│   ├── watch-point-detector.ts # Vessel tracking and watch point passage detection
│   ├── watch-points.ts       # WATCH_POINTS env parsing/validation
│   ├── ntfy-client.ts        # ntfy HTTP API client
│   ├── webhook-client.ts     # Signed JSON webhook client
│   ├── wikidata.ts           # Cached Wikidata vessel lookup for alert details
│   ├── geo.ts                # Geographic calculations
│   ├── types.ts              # TypeScript type definitions
│   └── __tests__/            # Unit tests
├── package.json
├── tsconfig.json
├── config/vitest.config.ts
└── README.md
```

- Connects to the WebSocket proxy as a client
- Tracks vessel positions and detects vessels passing configurable watch points (default: Blue Water Bridge), firing at the predicted moment of closest approach
- Sends push notifications via [ntfy](https://ntfy.sh) and/or signed JSON webhooks, enriched with Wikidata vessel details (photo, build year, operator)
- Per-vessel, per-point cooldown to prevent duplicate notifications
- See [services/vessel-notifier/README.md](services/vessel-notifier/README.md) for details

## Code Conventions

### TypeScript

- Use strict TypeScript with proper type definitions
- Define interfaces for all AIS data structures in `src/types/ais.ts`
- Prefer interfaces over type aliases for object shapes
- Use proper return types for all functions

### React

- Use functional components with hooks exclusively (no class components)
- Custom hooks should start with `use` prefix
- Keep components focused and single-purpose
- Use React 19 patterns (avoid deprecated features)

### Styling

- Use Tailwind CSS utility classes for all styling
- Follow responsive design patterns (mobile-first)
- Use Headless UI components for interactive elements (modals, dropdowns, etc.)
- Keep inline styles to a minimum; prefer Tailwind utilities

### File Organization

- One component per file
- Co-locate related types with their components when specific to that component
- Shared types go in `src/types/`
- Utility functions go in `src/utils/`
- Constants go in `src/constants/`

### Naming Conventions

- Components: PascalCase (e.g., `ShipMap.tsx`)
- Hooks: camelCase with `use` prefix (e.g., `useAISStream.ts`)
- Utilities: camelCase (e.g., `geo.ts`)
- Types/Interfaces: PascalCase (e.g., `AISMessage`)
- Constants: UPPER_SNAKE_CASE or camelCase for objects

## Development Workflow

### Starting the Development Server

```bash
npm run dev  # Starts both WebSocket proxy and Vite dev server
```

This command:

1. Starts the WebSocket proxy server on port 3001
2. Starts Vite dev server on port 5173
3. Both run concurrently for full-stack development

### Environment Variables

- Copy `.example.env` to `.env` for local development
- Required: `AISSTREAM_API_KEY` unless `AIS_SOURCES` leaves out `aisstream`; `AISHUB_API_KEY` when it includes `aishub`
- Optional: `PORT` (default: 3001), `WS_AUTH_TOKEN` (production auth), `VITE_WS_PROXY_URL`, `VITE_WS_AUTH_TOKEN`, `AIS_SOURCES` (default: `aisstream,local`), `AISHUB_API_KEY`, `LOCAL_AIS_HOST`, `LOCAL_AIS_PORT` (default: 5012), `LOCAL_AIS_WEB_URL` (AIS-catcher's web view, linked from the status menu), `SHIP_LOG_FILE` (default: `data/ship-log.json`), `DB_FILE` (default: `data/bridgeview.db`), `VESSEL_REGISTRY` (default: true), `USCG_LOOKUP` (default: true), `TRUST_PROXY` (take client IP from the proxy's `X-Real-IP`), `MAX_CONNECTIONS_PER_IP` (default: 20), `AIRCRAFT_TRACKING` (default: true), `ADSB_URL` (default: adsb.fi around the bridge), `YOUTUBE_API_KEY` (follow the ship cam's live video), `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_KEY` or `APNS_KEY_FILE` (iOS bridge alerts)
- Never commit `.env` file (it's gitignored)

### Building for Production

```bash
npm run build    # TypeScript compilation + Vite build
npm run preview  # Preview production build locally
```

### Linting

```bash
npm run lint  # Run ESLint
```

### Testing

```bash
npm test              # Run tests in watch mode (Vitest)
npm run test:run      # Run tests once
npm run test:coverage # Run tests with coverage report
npm run test:ui       # Run tests with interactive UI
```

See [TESTING.md](TESTING.md) for comprehensive test documentation.

## Key Features to Maintain

### Real-time Data Flow

1. WebSocket server (`server/server.js`) connects to AISStream.io
2. Frontend connects to local WebSocket server via `useAISStream` hook
3. AIS messages update ship positions in real-time
4. Map and list views stay synchronized

### Geographic Calculations

- Use utilities in `src/utils/geo.ts` for distance and bearing calculations
- Blue Water Bridge coordinates are in `src/constants/bridge.ts`
- Calculate ETA to bridge based on current position, speed, and course

### Map Rendering

- MapLibre GL handles high-performance map rendering via react-map-gl
- Custom ship markers show vessel positions and headings with rotation
- Map supports dark/light themes and 3D pitch alignment
- Map updates smoothly without full re-renders
- TV mode (header TV button, or open `/?tv`; `/?tv=<cam id>` picks the cam): full-screen map with no header or panels, and the map's buttons and cursor hidden after 3s without movement; shows the biggest ship heading for the bridge (the closest of equal ones; kept once followed) from about 12 min out (details, photo, countdown) with the map tilted to frame it and the bridge, looking from the ship to the bridge, then from about 9 min drops lower in behind it; switches to the full-screen ship cam with the ship's details in the corner while a ship under way (the biggest) is within 1 NM of the bridge (0.8 NM downbound; until it's 1.3 NM away). Esc or the Exit button leaves
- In 3D (pitched) view the map fades to satellite imagery (Esri World Imagery), ships become simple 3D models by AIS type with a wake (`utils/shipModel.ts`, `wakeOutline` in `utils/hull.ts`), the bridge is modelled in 3D (`utils/bridgeModel.ts`, spans from OpenStreetMap), aircraft fly as 3D models at their altitude (`utils/aircraftModel.ts`), and there's a sky and a wider field of view. In TV mode the imagery covers the whole base map (no labels or borders)
- The map's globe button also shows satellite imagery in the flat view
- Ships, planes and hulls are dead-reckoned between reports and eased onto each new one (`utils/motion.ts`); the selected ship stays centred until the map is dragged

## Common Tasks

### Adding New Ship Properties

1. Update type definitions in `src/types/ais.ts`
2. Update ship list display in `src/components/ShipList.tsx`
3. Consider adding to map tooltip/popup if relevant

### Modifying Map Behavior

1. Map component is in `src/components/ShipMap.tsx`
2. Map configuration (center, zoom, bounds) can be adjusted
3. Use MapLibre GL documentation for advanced features

### Changing WebSocket Configuration

1. Server configuration is in `server/server.js`
2. Frontend connection logic is in `src/hooks/useAISStream.ts`
3. Ensure both sides use matching message formats

### Styling Updates

1. Global styles are in `src/index.css`
2. Component-specific styles use Tailwind utilities
3. Tailwind config is handled by @tailwindcss/vite plugin

## Important Notes

### AIS Data Specifics

- MMSI: Unique vessel identifier (9 digits)
- Position updates include latitude, longitude, speed, course, heading
- Not all vessels broadcast all fields (handle missing data gracefully)
- Navigation status codes: 0=underway, 1=at anchor, 5=moored, etc.

### Performance Considerations

- Ship positions update frequently; use React.memo for expensive renders
- Limit the number of ships displayed if performance degrades
- Map should handle 50+ vessels smoothly
- WebSocket reconnection logic handles connection drops

### Testing During Development

- Use AISStream.io's geographic filtering for relevant area
- Blue Water Bridge coordinates: ~42.97°N, 82.42°W
- Test with both moving and stationary vessels
- Verify ETA calculations make sense

## Dependencies Management

### Adding Dependencies

```bash
npm install <package>      # Production dependency
npm install -D <package>   # Dev dependency
```

### Updating Dependencies

- Check for updates regularly but test thoroughly
- React 19 may have breaking changes from older versions
- MapLibre GL updates may affect map rendering
- TypeScript 7 has no JS API yet, which typescript-eslint needs, so `typescript` is an alias for `@typescript/typescript6` (the TS 6 API, for ESLint) and TS 7 is installed as `typescript7`. Compile and type-check with `npm run tsc` (TS 7's `tsc`), not `npx tsc`: both packages ship a `tsc` bin, so `node_modules/.bin/tsc` may be TS 6

## Git Workflow

- Main branch: `main`
- Commit messages should be clear and descriptive
- Include context about what changed and why
- Test thoroughly before committing

## CI/CD

- GitHub Actions workflow in `.github/workflows/test.yml`
- Runs on push to `main` and PRs targeting `main`
- Tests on Node.js 26.x
- Pipeline: lint → type check → tests with coverage → build
- Coverage uploaded to Codecov

## Docker

The app can be containerized using `docker compose`. See [infra/DOCKER.md](infra/DOCKER.md) for full documentation.

```bash
docker compose up --build -d   # Build and start
docker compose logs -f         # View logs
docker compose down            # Stop
```

Key files:

- `infra/Dockerfile`: Multi-stage build (build → ws-server, frontend targets)
- `docker-compose.yml`: Orchestrates ws-server and nginx frontend services
- `infra/nginx.conf`: Nginx config for static files and WebSocket proxying
- `.dockerignore`: Excludes unnecessary files from Docker builds

## Deployment Considerations

- Build output goes to `dist/` directory
- Requires Node.js (v26+) server to run WebSocket proxy
- Environment variables must be configured on server
- Ensure AISStream.io API key is available in production environment
- Set `WS_AUTH_TOKEN` for production WebSocket authentication
- Docker deployment available via `docker compose` (see [infra/DOCKER.md](infra/DOCKER.md))

## Additional Resources

- [React 19 Docs](https://react.dev)
- [MapLibre GL JS Docs](https://maplibre.org/maplibre-gl-js/docs/)
- [Tailwind CSS Docs](https://tailwindcss.com/docs)
- [AISStream.io API](https://aisstream.io)
- [react-map-gl Docs](https://visgl.github.io/react-map-gl/)
- [Vitest Docs](https://vitest.dev)

## Project Context

This project was built with AI assistance (Claude) and follows modern web development best practices. The codebase prioritizes clarity, maintainability, and performance. When making changes:

1. Understand the existing patterns before modifying
2. Keep the architecture consistent
3. Test real-time data flow after changes
4. Maintain type safety throughout
5. Consider mobile users (responsive design)
6. Handle edge cases gracefully (missing data, connection drops)

---

When working on this project, prioritize user experience, real-time performance, and code maintainability. The app should feel responsive and reliable even with continuous data streaming.
