# bball-clone

A small Unity 3D basketball game scaffold — a *knockoff* of NBA 2K, not a clone of it.
Everything (court, hoops, players, ball, sounds) is generated procedurally from
primitives at runtime, so this repo contains **zero downloaded assets** and no
copyrighted material (no team names, player likenesses, logos, etc.).

## What's here

- Full-size court (28m × 15m) with hand-drawn lines (key, 3-point arc, midcourt circle)
- Two hoops with backboard, rim, and a simple net
- 10 players (1 user-controlled + 4 AI teammates + 5 AI opponents) built from
  capsules/spheres/cubes with team-colored jerseys
- Ball with Unity physics (bouncy, frictional, spins in flight)
- Procedural materials (wood-grain floor, seamed orange ball)
- Procedural audio (dribble thumps, shot whoosh, pass slap, swish)
- Simple AI state machine (chase loose ball → drive/shoot if ball-handler → cut
  to open spot if teammate has it → man-mark if defending)
- Scoring detection (2pt / 3pt), 4 quarters × 2 minutes, scoreboard HUD
- Switchable controlled player (Tab)

## Requirements

- Unity **2022.3 LTS** (the project pins `2022.3.40f1` but any 2022.3.x should
  open it; newer versions will offer to upgrade)

## First-time setup

The project ships with only the bare-minimum settings — Unity generates the rest
on first open, and the scene is built at runtime, so:

1. Open Unity Hub → **Open** → pick this folder (`games/bball-clone`).
2. Wait for Unity to import (first time takes a few minutes).
3. In the Project window, **right-click `Assets/Scenes` → Create → Scene**.
   Name it `Game`.
4. Open `Game.unity` (double-click), then press **Play**.

The `Bootstrap` script runs via `[RuntimeInitializeOnLoadMethod]` and builds the
entire scene — court, hoops, players, ball, camera, lights — so the scene file
itself can be empty.

> If you skip step 3, Unity won't have a scene to play. Any empty scene works.

## Controls

| Action | Key |
| --- | --- |
| Move | `W A S D` |
| Sprint | `Left Shift` |
| Pick up loose ball | `E` |
| Shoot (hold to charge) | `Left Mouse` |
| Pass to nearest teammate ahead | `Right Mouse` |
| Jump | `Space` |
| Switch to nearest controllable teammate | `Tab` |
| Rotate camera | `Middle Mouse` + drag |

## Project layout

```
games/bball-clone/
├── Assets/
│   ├── Scenes/             # you create Game.unity here on first open
│   └── Scripts/            # all game logic
├── Packages/manifest.json  # minimum Unity packages
├── ProjectSettings/
│   └── ProjectVersion.txt  # rest of ProjectSettings are auto-generated
├── .gitignore
└── README.md
```

## Swapping in real assets later

Everything is procedural so the project runs offline with no asset pipeline. If
you want real models / textures / sounds later (use CC0 sources like
[Poly Pizza](https://poly.pizza/), [ambientCG](https://ambientcg.com/),
[Freesound CC0](https://freesound.org/)), the swap points are:

- `MatLib.cs` — `WoodTexture()` / `BallTexture()`: return a loaded `Texture2D`
  instead of the procedural one.
- `PlayerFactory.cs` — replace the primitive-built body with `Instantiate(prefab)`.
- `ProcAudio.cs` — replace the `MakeThump()` / `MakeSwish()` calls with
  `Resources.Load<AudioClip>("sfx/swish")` etc.

## What's deliberately not here

Built-in-one-shot caveats — this is a *skeleton*, not a shipped game:

- No animation rig (players slide; no dribble/run/shoot anim)
- AI is reactive only, no offensive plays / pick & roll / set defense
- No fouls, no free throws, no shot clock, no out-of-bounds inbound pass — the
  ball just resets to center
- Physics tuning (bounciness, shot arc, pass speed) is by feel, not measured
- Tab-switch hard-swaps `HumanPlayer`/`AIPlayer` components at runtime; works
  but is a hack
- No multiplayer, no menus, no save data

These are all reasonable next steps.
