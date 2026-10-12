# VanLife

VanLife is a camper van marketplace app built with React. Visitors can browse vans, renters can request trips, and hosts can manage bookings, reviews, income, and their van inventory.

The app uses API-backed data, role-aware navigation, and a module-driven frontend structure while keeping the code approachable and easy to follow.

## Screenshots

| Home | Public Vans |
| --- | --- |
| ![Home](docs/screenshots/home.png) | ![Public vans browse](docs/screenshots/vans-browse.png) |

| Van Detail | Renter Bookings |
| --- | --- |
| ![Van detail booking flow](docs/screenshots/van-detail.png) | ![Renter bookings](docs/screenshots/renter-bookings.png) |

| Host Dashboard | Host Inventory |
| --- | --- |
| ![Host dashboard](docs/screenshots/host-dashboard.png) | ![Host van inventory](docs/screenshots/host-vans.png) |

## Features

- Public van browsing with search, type filters, sorting, and pagination
- Van detail pages with booking requests
- Renter bookings with status filters, sorting, pagination, cancellation, and read-only submitted reviews
- Host dashboard, income, reviews, bookings, and van inventory management
- Host create, edit, and archive workflows for listed vans
- Sign in, sign up, sign out, account, and password management
- Role-aware navigation for public, renter, and host users

## Backend

This frontend expects the VanLife API to run separately:

[kangcommit/vanLife-api](https://github.com/kangcommit/vanLife-api)

Create `.env` in the project root and point the frontend to the API:

```bash
VITE_API_BASE_URL=http://localhost:PORT
```

Replace `PORT` with the backend port.

## Demo Accounts

```txt
Host:        host@vanlife.test / password123
Second host: host.two@vanlife.test / password123
Renter:      renter@vanlife.test / password123
```

## Tech Stack

| Category | Technology |
| --- | --- |
| Framework | React |
| Routing | React Router |
| Server state | TanStack Query |
| HTTP client | Axios |
| Styling | Tailwind CSS |
| UI variants | Tailwind Variants |
| Charts | Recharts |
| Calendar | React DayPicker |
| Language | TypeScript |
| Tooling | Vite, Biome, pnpm |

## Getting Started

Requirements:

- Node.js
- pnpm
- VanLife API running locally

Install dependencies:

```bash
pnpm install
```

Start the development server:

```bash
pnpm dev
```

The app runs on:

```txt
http://localhost:3000
```

## Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Start the local Vite server |
| `pnpm build` | Build for production |
| `pnpm preview` | Preview the production build |
| `pnpm typecheck` | Run TypeScript checks |
| `pnpm check` | Run Biome checks |
| `pnpm check:fix` | Format and fix supported Biome issues |
| `pnpm check:staged` | Check staged files |

## Architecture

The app follows a module-driven structure:

```txt
src/
  app/
  modules/
  shared/
  assets/
```

- `src/app` owns app composition, routes, layouts, guards, and app-level pages.
- `src/modules/*` owns feature modules such as auth, vans, bookings, and host.
- `src/shared` owns reusable neutral code and cross-module domain code.
- Modules do not import from other modules.
- Shared code does not import from app or modules.

## Quality Checks

Run these before considering a change complete:

```bash
pnpm typecheck
pnpm check
```
