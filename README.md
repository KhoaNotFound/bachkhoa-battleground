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

The campus is the 3D model "Truong Dai Hoc Bach Khoa" by PORTCOAST on Sketchfab, exported as OBJ and converted by
`tools/build_obj_map.py` into `assets/map/` (quantized geometry, collision boxes, boundary, spawn points, minimap image), at real scale (~560 × 450 m).

```bash
uv venv tools/.venv && uv pip install --python tools/.venv/bin/python numpy scipy pillow opencv-python-headless fast-simplification
tools/.venv/bin/python tools/build_obj_map.py "<folder with model_N.obj>"
```

`tools/extract_frames.py` extracts frames from a campus video (PyAV) for photogrammetry / depth experiments.
