# BridgeView AIS

A real-time ship tracking application that displays vessel traffic near the Blue Water Bridge using Automatic Identification System (AIS) data.

## Overview

BridgeView AIS is a web-based maritime tracking tool that provides live visualization of ship movements and detailed vessel information. Built with modern web technologies, it offers an intuitive interface for monitoring shipping activity in the Blue Water Bridge area.

## Features

- **Real-time Ship Tracking**: Live AIS data streaming via WebSocket for up-to-the-second vessel positions
- **Interactive Map**: MapLibre GL-powered map with smooth rendering and dark/light mode support
- **Vessel Details**: Comprehensive ship information including:
  - Vessel name, type, and flag
  - Current speed, course, and heading
  - Destination and ETA
  - Dimensions (length, width, draft)
  - MMSI and IMO identification
- **Modern UI**: Built with Tailwind CSS and Headless UI for a clean, responsive interface
- **Notification System**: Real-time updates and alerts

## Tech Stack

- **Frontend**: React 18 + TypeScript
- **Build Tool**: Vite
- **Mapping**: MapLibre GL JS
- **Styling**: Tailwind CSS
- **UI Components**: Headless UI
- **Icons**: Heroicons
- **Data Source**: AIS data stream via WebSocket proxy

## Getting Started

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd bridgeview-ais
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
```
Add your configuration to the `.env` file.

4. Start the development server:
```bash
npm run dev
```

5. Start the WebSocket proxy server:
```bash
node server/websocket-proxy.js
```

The application will be available at `http://localhost:5173`

## Development

This project was built using React, TypeScript, and Vite, with hot module replacement (HMR) for a smooth development experience.

### Available Scripts

- `npm run dev` - Start the development server
- `npm run build` - Build for production
- `npm run preview` - Preview the production build
- `npm run lint` - Run ESLint

## Architecture

The application consists of:
- **React frontend**: Handles UI rendering and user interactions
- **WebSocket proxy server**: Manages AIS data stream connections
- **MapLibre GL**: Provides interactive map visualization
- **Component architecture**: Modular design with ShipMap, ShipList, and NotificationPanel components

## About

This project was mostly vibe coded with [Claude](https://claude.ai) - an AI assistant by Anthropic. The development process leveraged AI-assisted coding to rapidly prototype and build features, resulting in a functional maritime tracking application.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please see the [CONTRIBUTING.md](CONTRIBUTING.md) file for guidelines on how to contribute to this project.
