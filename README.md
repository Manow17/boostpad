# Boostpad

A free, open-source cosmetic mod manager for Rocket League on Windows (Epic Games and Steam).

No account, no subscription, no central server. Everything runs on your PC, and every game file Boostpad changes is backed up first and can be put back with one click.

> **Status: early (v0.1).** The app, the backup engine, workshop maps, mod packs, presets, tracker, overlay and profile cards work. **Item swaps are experimental and have not been confirmed in game yet** — see [What works](#what-works) before you rely on them.

## Read this first

- Rocket League runs with Easy Anti-Cheat. Boostpad does **not** touch, disable or work around it, and it never injects into or reads the running game. It only replaces files on disk while the game is closed.
- Changing game files may break Rocket League's terms of service and could put your account at risk. Nobody can promise modified files are accepted online. **Use it at your own risk.**
- Your launcher's "Verify files" always restores a clean install.
- Boostpad is a fan project, not affiliated with or endorsed by Psyonix or Epic Games.

## Features

| Tab | What it does |
| --- | --- |
| **Garage** | Give an item you own the look of another item (cars, wheels, boosts, decals, toppers, antennas, engine sounds, trails, goal explosions, paint finishes, banners, borders, anthems). Random pick included. |
| **Mod Packs** | Apply community packs: custom balls, decals, boost meters, wheels, lobby backgrounds, loading screens, menu music, sounds. |
| **Workshop Maps** | Load a training/challenge map into the Underpass slot and play it from Free Play. |
| **Presets** | Save everything that is active and switch setups in one click. Unlimited. Share as a code or through a sync server. |
| **Active** | See every change in your game, revert one or all. Shows the queue. |
| **Swap queue** | Changes made while the game is running wait and go in when it closes. |
| **MMR Tracker** | Log your rating per playlist; see today's change, peak and a trend line. |
| **Overlay** | Always-on-top controller input display and MMR counter, resizable. |
| **Music** | Built-in player for your own audio files. |
| **Profile** | A profile card with any name, title, colour, glow, rank badge and picture, shareable with other Boostpad users. |
| **Themes** | Accent colour and background. |

## What works

| Area | State |
| --- | --- |
| Finding the game (Epic, Steam), running check, Play button | Tested on an Epic install |
| Backup, restore, queue, game-update detection | Covered by automated tests on copies of real game files |
| Item catalog | Built from your own install (about 8,600 items on the test machine) |
| Item swaps | **Experimental.** The package rewrite is tested structurally (see below) but nobody has yet confirmed the result in game |
| Workshop maps, mod packs | File replacement is tested; whether a given map or pack loads depends on the file |
| Tracker, overlay, music, profile, sync server | Working; the overlay has not been tested over the game with a controller |

Known limits of item swaps in this version:

- A swap renames the new look's package to your item's name **in place**, so the new look's internal name must not be longer than your item's. The app tells you when a pair cannot be done.
- Only packages encrypted with the long-published community key can be read (roughly two thirds of items on the test machine). Newer packages use keys Boostpad does not have and does not try to obtain.
- Items are listed under their internal file names, which sometimes differ from the shop names, and tiles have no thumbnails yet.

Not implemented: custom paint colours, 3D garage preview, converting your own MP3s into game sounds, stadium colours, and changing your name, title or rank **inside** the game. The last one would need code injected into the running game, which Boostpad does not do.

## Run it

Requires [Node.js](https://nodejs.org) 20 or newer.

```
git clone https://github.com/Manow17/boostpad.git
cd boostpad
npm install
npm start
```

Run the tests (they copy a few packages to a temp folder and never write to your game):

```
npm test
```

## Mod pack format

A pack is a folder with a `pack.json` and the replacement files:

```json
{
  "name": "My Ball",
  "type": "ball",
  "author": "you",
  "files": {
    "Ball_Default_SF.upk": "my_ball.upk"
  }
}
```

`files` maps a file name in `TAGame\CookedPCConsole` to a file inside the pack. `type` is one of `ball`, `decal`, `boostmeter`, `wheels`, `menu`, `loading`, `music`, `sound`, `other`. Add the folder from the Mod Packs tab. Only install packs from people you trust: a pack replaces game files.

## Sync server (optional)

Profile cards and community presets are shared through a tiny server anyone can host. It has no dependencies:

```
npm run server          # http://localhost:8787
```

Put its address in **Profile → Sharing**. Publish your card, give friends your profile ID, or publish presets for everyone on that server. There is no official server.

## How a swap works

Each item is a package file such as `WHEEL_Star_SF.upk` whose contents answer to the name `WHEEL_Star`. To make item A look like item B, Boostpad takes B's package, renames `B` to `A` in its name table, and writes the result over A's file. The rename keeps the exact byte size (shorter names are padded), so nothing else in the file moves and the compressed data is never rewritten. A's original file is copied to Boostpad's data folder first.

## Project layout

```
src/main/core/   game.js (find game)  upk.js (package reader/patcher)  engine.js (apply, back up, revert, queue)
                 catalog.js (items)   library.js (maps, packs)         store.js (settings)
src/main/        main.js (window, IPC)  preload.js
src/renderer/    app.js, styles.css, overlay
server/          optional sync server
test/            core tests
```

## Contributing

Reports of what does and does not load in game are the most useful thing right now. Please include the two items and what you saw.

## License

MIT. Rocket League is a trademark of Psyonix LLC. This repository contains no game assets.
