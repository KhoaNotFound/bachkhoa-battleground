# Bách Khoa Battleground

A browser multiplayer FPS (free-for-all, ~10 players) set on a low-poly reconstruction of the HCMUT campus (268 Lý Thường Kiệt).
Everyone has 100 HP and two weapons: fists and an AWM. Pick a name and press **VÀO TRẬN** to spawn; when you die you go back to the lobby.

## Play

Open the GitHub Pages link, enter a name, press play. Needs a keyboard and mouse.

| Key | Action |
| --- | --- |
| W A S D | move |
| Shift | sprint |
| Space | jump |
| C | crouch |
| Left mouse | fire / punch |
| Right mouse | scope (AWM) |
| R | reload |
| 1 / 2 / Q / wheel | switch weapon |
| Tab | scoreboard |
| Esc | pause |

Damage: AWM headshot 250 (instant kill), body 85, legs 65. Fists: 25 (head 35).
A kill heals 25 HP. After 7 s without taking damage you regenerate.
You get 2.5 s of spawn protection; firing ends it early.

## Networking

The client is a static site (Three.js from a CDN, no build step). Players sync through one of two transports:

1. **Relay server** (`server/`): WebSocket, low latency. Started with `./start-server.sh`, which opens a Cloudflare quick tunnel and writes its URL to `server.json`.
2. **Public MQTT broker** (`broker.emqx.io`): automatic fallback whenever the relay is offline, so the link always works.

The relay server is also bridged to MQTT, so players on either transport share the same world.
Rooms: append `?room=name` to the URL to create a private room.

## Map

Building footprints, the campus boundary, roads and sports pitches come from **OpenStreetMap** (© OpenStreetMap contributors, ODbL),
converted by `tools/build_campus.py` into `js/campus-data.js` (rotated so the street grid is axis-aligned, scaled to 70% for a ~10 player match).
Heights, facades, trees, stairs and props are generated in `js/map.js`. The Portcoast Sketchfab model was only used as a visual reference and is not redistributed.

To refresh the data, re-download the Overpass extract into `tools/osm-campus.json` and run `python3 tools/build_campus.py`.
