# RATBV Bus Scraper 🚌

A web-based bus schedule scraper for RATBV (Brașov public transport) with a dashboard to manage multiple routes.

## Features

- ✨ **Dynamic Route Management** - Add, view, and delete bus routes through a web dashboard
- 🎨 **Clean UI** - Solid color design with smooth animations
- ⏰ **Real-time Scraping** - Fetches live bus schedules from RATBV website
- 📱 **Responsive Design** - Works on desktop and mobile devices
- 🎯 **Next Bus Highlight** - Automatically highlights the next upcoming bus

## Installation

```bash
bun install
```

## Usage

Start the server:
```bash
bun run index.ts
```

The server will run on `http://localhost:420`

## Routes

- **`/`** - Homepage showing all configured routes
- **`/dashboard`** - Admin dashboard to manage routes
- **`/route/:id`** - View bus times for a specific route
- **`/api/routes`** - API endpoints (GET, POST, DELETE)

## Dashboard

Access the dashboard at `http://localhost:420/dashboard` to:

1. **Add New Routes**: Enter route ID, name, station name, and RATBV URL
2. **View Routes**: See all configured routes with their details
3. **Delete Routes**: Remove routes you no longer need

## Adding a Route

1. Go to `/dashboard`
2. Fill in the form:
   - **ID**: URL-friendly identifier (e.g., `sala-sporturilor`)
   - **Name**: Display name (e.g., `Linia 23B`)
   - **Station Name**: Station name (e.g., `Sala Sporturilor`)
   - **URL**: Full RATBV page URL
3. Click "Adaugă Rută"

## Data Storage

Routes are stored in `routes.json` in the project root.

## Technologies

- **Bun** - JavaScript runtime and web server
- **Selenium WebDriver** - Web scraping
- **TypeScript** - Type-safe code

## ratbvscraper

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.1.29. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.
