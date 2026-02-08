# BridgeView AIS

![Test & Build](https://github.com/tmcknight/bridgeview-ais/actions/workflows/test.yml/badge.svg?branch=main)

A real-time ship tracking application that displays vessel traffic near the Blue Water Bridge using Automatic Identification System (AIS) data.

## 🔍 Overview

BridgeView AIS is a web-based maritime tracking tool that provides live visualization of ship movements and detailed vessel information. Built with modern web technologies, it offers an intuitive interface for monitoring shipping activity in the Blue Water Bridge area.

## ✨ Features

- **Real-time Ship Tracking**: Live AIS data streaming via WebSocket for up-to-the-second vessel positions
- **Interactive Map**: MapLibre GL-powered map with smooth rendering
- **Vessel Details**: Comprehensive ship information including:
  - Vessel name and navigation status
  - Current speed, course, and heading
  - Destination and estimated time to bridge
  - Dimensions (length and width)
  - MMSI identification
- **Modern UI**: Built with Tailwind CSS and Headless UI for a clean, responsive interface
- **Notification System**: Real-time updates and alerts

## 🛠️ Tech Stack

- **Frontend**: [React](https://github.com/facebook/react) 19 + [TypeScript](https://github.com/microsoft/TypeScript)
- **Build Tool**: [Vite](https://github.com/vitejs/vite)
- **Mapping**: [Leaflet](https://github.com/Leaflet/Leaflet) + [MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js)
- **Styling**: [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss)
- **UI Components**: [Headless UI](https://github.com/tailwindlabs/headlessui)
- **Icons**: [Heroicons](https://github.com/tailwindlabs/heroicons)
- **WebSocket**: [ws](https://github.com/websockets/ws)
- **Data Source**: Real-time AIS data from [AISStream.io](https://aisstream.io)

## 🚀 Getting Started

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone https://github.com/tmcknight/bridgeview-ais.git
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

This command starts both the WebSocket proxy server and the Vite development server. The application will be available at `http://localhost:5173`

## 👨‍💻 Development

This project was built using React, TypeScript, and Vite, with hot module replacement (HMR) for a smooth development experience.

### Available Scripts

- `npm run dev` - Start both the WebSocket proxy server and Vite development server
- `npm run server` - Start only the WebSocket proxy server
- `npm run build` - Build for production
- `npm run preview` - Preview the production build
- `npm run lint` - Run ESLint
- `npm test` - Run tests in watch mode
- `npm run test:run` - Run tests once
- `npm run test:coverage` - Run tests with coverage report
- `npm run test:ui` - Run tests with interactive UI

## 🏗️ Architecture

The application consists of:
- **React frontend**: Handles UI rendering and user interactions
- **WebSocket proxy server**: Manages AIS data stream connections
- **MapLibre GL**: Provides interactive map visualization
- **Component architecture**: Modular design with ShipMap, ShipList, and NotificationPanel components

## 📡 Data Source

This application is made possible by [AISStream.io](https://aisstream.io), a free service that provides real-time AIS (Automatic Identification System) data via WebSocket connections. AISStream.io aggregates data from a global network of AIS receivers and makes it accessible to developers building maritime tracking applications.

Special thanks to AISStream.io for providing free access to live vessel tracking data.

## ℹ️ About

This project was mostly vibe coded with [Claude](https://claude.ai) - an AI assistant by Anthropic. The development process leveraged AI-assisted coding to rapidly prototype and build features, resulting in a functional maritime tracking application.

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🤝 Contributing

Contributions are welcome! Please see the [CONTRIBUTING.md](CONTRIBUTING.md) file for guidelines on how to contribute to this project.
