# Room Attendance Tracker

A simple mobile-friendly collaborative attendance website. Everyone in a room can mark or correct attendance.

## Run locally

1. Install Node.js 18+.
2. Open this folder in a terminal.
3. Run:

```bash
npm install
npm start
```

4. Open `http://localhost:3000`.

For phones on the same Wi-Fi, use the computer's local IP, for example:

`http://192.168.1.10:3000`

## Deploy

This app works on Node-compatible hosts such as Render, Railway, Fly.io, or a VPS.

Build command: `npm install`
Start command: `npm start`

The app stores its data in `data.json`. For production, attach persistent disk/storage if the hosting provider uses an ephemeral filesystem.

## Features

- Create or join a room with a short code
- Add/remove members
- Everyone can edit attendance
- Present / Absent / Leave
- Attendance percentage
- Real-time updates using WebSockets
- Mobile-friendly UI

## Important

This first version intentionally has no passwords or accounts. Anyone who knows the room code can edit that room. Keep the room code private.

## Daily-only behavior

This version keeps attendance for the current day only. Previous-day attendance is automatically cleared when the server loads or when room data is accessed after the date changes.
