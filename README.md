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
| 1–6 / Q / wheel | switch weapon (fist, AWM, knife, UMP45, M416, AKM) |
| Tab | scoreboard |
| Esc | pause |

Guns have PUBG-style recoil (`js/weapons.js`): every bullet kicks the real aim up and sideways, the climb ramps up over the first shots
and does not return by itself – pull the mouse down to control the spray. ADS −20 %, crouch −15 %, moving +10 %, airborne +40 %.
Each gun has a weight that scales move speed (`1.15 − 0.05·kg`):

| Gun | Weight | Speed | Body dmg | Fire rate | Mag | Climb per 30 shots |
| --- | --- | --- | --- | --- | --- | --- |
| UMP45 | 2.3 kg | ×1.03 | 20 | 600 rpm | 25 | ~9° (easy) |
| M416 | 3.5 kg | ×0.97 | 24 | 700 rpm | 30 | ~14° |
| AKM | 4.3 kg | ×0.93 | 30 | 600 rpm | 30 | ~26° (hard) |
| AWM | 6.8 kg | ×0.81 | 85 | bolt | 5 | one 2.6° kick per shot |

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

## Gun feel: recoil and weight (`js/gunfeel.js`)

* **Recoil (PUBG style):** every bullet kicks the real aim up and sideways; the climb ramps up over the first bullets
  and does not return by itself – pull the mouse down to control the spray. The sideways pattern is deterministic per gun.
  ADS −20 %, crouch −15 %, moving +10 %, airborne +40 %. Bloom (random cone) grows during a spray and is added to the base spread.
  Per-gun tuning lives in `GUN_FEEL` (e.g. Phantom ≈ 14° climb over 30 bullets, Vandal ≈ 20°, Odin ≈ 24°).
* **Weight:** each gun has a mass in kg, move speed ×`1.15 − 0.05·kg` (clamped 0.7–1.2): pistols ~×1.1, SMGs ~×1.03,
  rifles ~×0.96, snipers ×0.81–0.89 (Operator 6.8 kg = ×0.81), Ares ×0.80, Odin 9.5 kg = ×0.70. Heavier guns are slower in ADS too.
