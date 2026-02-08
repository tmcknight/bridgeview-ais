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
│   ├── ShipList.tsx   # List view of tracked vessels
│   ├── NotificationPanel.tsx  # Real-time alerts
│   ├── StatusBar.tsx  # Connection status indicator
│   ├── ErrorBoundary.tsx          # App-level error boundary
│   └── ComponentErrorBoundary.tsx # Component-level error boundary
├── hooks/
│   ├── useAISStream.ts  # WebSocket connection management
│   └── useTheme.ts      # Dark/light theme toggle
├── types/
│   └── ais.ts         # AIS data type definitions
├── constants/
│   └── bridge.ts      # Blue Water Bridge location data
├── utils/
│   ├── geo.ts         # Geographic calculations (distance, bearing, etc.)
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
- `server.js`: Secure WebSocket proxy server that connects to AISStream.io and relays messages to clients
  - Rate limiting (5 connections per IP, 60 messages per minute)
  - Optional authentication token support
  - Input validation and bounding box size limits
  - Subscription timeout protection

### Vessel Notification Service
```
services/vessel-notifier/
├── src/
│   ├── index.ts              # Entry point with env config
│   ├── notifier.ts           # Main service (WebSocket client, orchestration)
│   ├── bridge-detector.ts    # Vessel tracking and bridge crossing detection
│   ├── ntfy-client.ts        # ntfy HTTP API client
│   ├── geo.ts                # Geographic calculations
│   ├── types.ts              # TypeScript type definitions
│   └── __tests__/            # Unit tests (49 tests)
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```
- Connects to the WebSocket proxy as a client
- Tracks vessel positions and detects bridge crossings (< 0.5 NM)
- Sends push notifications via [ntfy](https://ntfy.sh)
- Per-vessel cooldown to prevent duplicate notifications
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
- Required: `AISSTREAM_API_KEY` for AISStream.io access
- Optional: `PORT` (default: 3001), `WS_AUTH_TOKEN` (production auth), `VITE_WS_PROXY_URL`, `VITE_WS_AUTH_TOKEN`
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
1. WebSocket server (`server.js`) connects to AISStream.io
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
1. Server configuration is in `server.js`
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

## Git Workflow

- Main branch: `main`
- Commit messages should be clear and descriptive
- Include context about what changed and why
- Test thoroughly before committing

## CI/CD

- GitHub Actions workflow in `.github/workflows/test.yml`
- Runs on push to `main` and PRs targeting `main`
- Tests on Node.js 20.x and 22.x matrix
- Pipeline: lint → type check → tests with coverage → build
- Coverage uploaded to Codecov (Node 22.x only)

## Docker

The app can be containerized using `docker compose`. See [DOCKER.md](DOCKER.md) for full documentation.

```bash
docker compose up --build -d   # Build and start
docker compose logs -f         # View logs
docker compose down            # Stop
```

Key files:
- `Dockerfile`: Multi-stage build (build → ws-server, frontend targets)
- `docker-compose.yml`: Orchestrates ws-server and nginx frontend services
- `nginx.conf`: Nginx config for static files and WebSocket proxying
- `.dockerignore`: Excludes unnecessary files from Docker builds

## Deployment Considerations

- Build output goes to `dist/` directory
- Requires Node.js (v20+) server to run WebSocket proxy
- Environment variables must be configured on server
- Ensure AISStream.io API key is available in production environment
- Set `WS_AUTH_TOKEN` for production WebSocket authentication
- Docker deployment available via `docker compose` (see [DOCKER.md](DOCKER.md))

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
