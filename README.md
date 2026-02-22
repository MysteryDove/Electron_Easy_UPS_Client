# Easy UPS Client

A modern desktop application for monitoring UPS systems via the NUT (Network UPS Tools) protocol.

## Overview

Easy UPS Client provides a user-friendly interface to monitor your UPS telemetry, and ensure your system is protected during power events. Built with Electron and React, it does have cross-platform capability but for now it's only for windows.

## Key Features

- **Real-time Monitoring**: Track voltage, load, battery level, and other critical UPS telemetry.
- **Visualized Data**: Sparkline charts for historical telemetry trends using eCharts and DuckDB.
- **Setup Wizard**: Easy step-by-step configuration for initial NUT connection.
- **Configurable Shutdowns**: Set custom countdowns for system shutdown during power failure events.
- **Multi-language Support**: Internationalization support via i18next.
- **Modern UI**: Clean, responsive design built with Tailwind CSS and Lucide icons.

## Technology Stack

- **Framework**: [Electron](https://www.electronjs.org/)
- **Frontend**: [React](https://reactjs.org/)
- **Build Tool**: [Vite](https://vitejs.dev/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **Icons**: [Lucide React](https://lucide.dev/)
- **I18n**: [i18next](https://www.i18next.com/)
- **Database**: [DuckDB](https://duckdb.org/) (for telemetry storage)

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (LTS recommended)
- [npm](https://www.npmjs.com/)

> [!IMPORTANT]
> **Manual NUT Configuration Required**
> NUT (Network UPS Tools) must be configured manually on the host system (or a remote server) before this client can connect to it. Ensure that the `upsd` service is running and accessible.

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/lsy39/electron_ups_easy_client.git
   cd electron_ups_easy_client
   ```

2. Install dependencies:
   ```bash
   npm install
   ```


### Development

Start the application in development mode:
```bash
npm start
```

## Building & Packaging

To package the application for your current platform:
```bash
npm run package
```

To create a Windows NSIS installer (`out/nsis/*.exe`):
```bash
npm run make
```

To run the two steps manually:
```bash
npm run package:win
npm run make:nsis
```

To use Electron Forge's default makers (zip/deb/rpm):
```bash
npm run make:forge
```

## Configuration

The application stores settings locally using `electron-store`. You can reset all settings on startup by running:
```bash
npm run start:reset-settings
```

## TODO List

- [ ] Maybe native integration with NUT on windows?

## License

This project is licensed under the MIT License - see the [package.json](package.json) file for details.

## Author

**MystDove** - [admin@iloli.ch](mailto:admin@iloli.ch)
