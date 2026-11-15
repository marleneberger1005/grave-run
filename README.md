# Grave Run

An original zombie maze-chase for the browser. Night has fallen over Ashgrove Cemetery: gather every soul shard, light road flares to turn the hunt around, and don't let the dead touch you.

**Play:** https://marleneberger1005.github.io/grave-run/

## Modes
- **Classic** — three lives, clear the yard night after night
- **Blackout** — your flashlight battery drains; soul shards trickle charge, flares refill it
- **Endless Horde** — another zombie claws out of the crypt every 45 seconds (up to 12)
- **Nightmare** — one life, faster dead, half-length flares, longer hunts

Each mode keeps its own best score.

## Features
- Dynamic lighting: a flickering flashlight cone with real line-of-sight shadows; zombie eyes glow in the dark
- Four zombie types with distinct hunting behaviour (Shambler, Stalker, Crawler, Brute), plus roam/hunt waves
- Flares make the horde panic so you can burn them; fallen zombies limp back to the crypt as skulls
- Adaptive horror score, fully synthesized with Web Audio: a broken music box that fades as dread rises, dissonant strings, an accelerating bass pulse, glassy shimmer, whispers, and string stingers when they get close
- Heartbeat and groans tied to how near the dead are, persistent blood decals, fog, film grain
- Keyboard, swipe, and on-screen D-pad controls; high score saved locally

## Controls
Arrows / WASD to move · 1–4 pick a mode on the title screen · P / Esc pause · Q exit to menu · M mute

## Run locally
No build step. Open `index.html`, or serve the folder:

```sh
python3 -m http.server 8000
```
