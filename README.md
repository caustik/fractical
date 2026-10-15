# Fractical

Walk into a fractal. Shrink to fit. Meet someone inside.

A playable experiment in treating the Mandelbrot set as solid, shared geometry. Your body occupies space. A narrow opening stops you until you shrink; growing is blocked when the larger body would overlap the rock.

Development and playtests run locally. Everyone connected to the same server can explore and build together; each server keeps its own worlds. A hosted public game is a separate decision. The server and Dockerfile are included for anyone who wants to host their own instance.

## Run

Use Node.js 22.12 or newer. From this directory:

```powershell
npm ci --ignore-scripts
npm run dev
```

Open <http://127.0.0.1:4173>. Astro serves the frontend and connects `/live` and `/health` to the game server. `start-fractical.cmd` starts the same development server on Windows and installs dependencies if they are missing.

To test the production build locally:

```powershell
npm run build
npm start
```

Astro writes `_site/`; the Node server serves that build and the live world on one port. `npm run preview` runs the same complete server. Persistent worlds stay in `.local/` across frontend rebuilds.

The font dependency is pinned to `unifont` 0.7.4 to preserve Astro's Node 22.12 minimum; newer releases pull in an HTTP client requiring Node 22.19. Review this pin when raising the supported Node version.

Open a second browser or a private window and use the same expedition link. Each explorer receives a generated name; choose a color in **Together**. Two tabs also work, but tabs in the same browser profile share their identity, color, and ownership credential. Restart the server and reload open pages after updating the prototype.

The server defaults to loopback. For a test with another computer or phone on your network:

```powershell
npm run dev -- --host 0.0.0.0
```

Visit `http://<this-computer's-LAN-address>:4173` on both devices. Use that address when copying invitations. Network and Windows firewall settings must permit the connection. This does not create a public internet link.

## The five-minute experiment

1. Join an expedition with one other person.
2. Choose **Try the opening** in Discover, or click the **THE NARROWS** marker in the first area. Your explorer walks towards it and stops where the body no longer fits.
3. Hold **E** for about three seconds while the route remains selected. Shrinking lets you continue through the opening.
4. Inside the narrow region, hold **Q**. Growth stops at the last legal size. Walk back into open space before growing further.
5. Press **B**, choose a material, and click nearby cells to assemble a wall or a shape. Drag your squares to rearrange it. Walk against it, or try growing inside the space you made. Zoom in and out to see the same squares at different sizes. Have the other explorer add their own blocks.
6. Use a preset signal to ask someone to follow or wait. Finish building with **B**, **Escape**, or **Done**.

The **Discover**, **Home**, **Meet**, invitation, and construction visit shortcuts land on clear ground. These are explicit relocations. Ordinary walking, click movement, following, and size changes use collision checks. Double-clicking shrinks in place and walks towards the selected point.

## Controls

| Action                          | Control                                |
| ------------------------------- | -------------------------------------- |
| Walk                            | WASD, arrow keys, or click the terrain |
| Travel faster                   | Hold Shift                             |
| Go smaller                      | Hold E, wheel up, or +                 |
| Grow when there is room         | Hold Q, wheel down, or -               |
| Shrink and walk towards a point | Double-click the terrain               |
| Start or finish building        | B or Build blocks                      |
| Place a block                   | Click or tap a highlighted cell        |
| Move your own square            | Drag it while building, or M / Move then select a square and a destination |
| Choose stone, glass, or glow    | 1, 2, 3 or the material buttons        |
| Remove your own blocks          | R or Remove, then select a block       |
| Edit the current cell           | Space while building; in Move, pick up then place |
| Cancel a move / finish building | Escape / Escape again, or Done          |
| Return home                     | H or Home                              |
| Walk on a phone                 | Drag the circular walking pad          |
| Meet or follow someone          | Together                               |

Optional sound is synthesized locally. It starts only when you turn it on. Fonts and graphics do not require third-party services.

## What works

- Solid Mandelbrot terrain, a circular body, wall sliding, and continuous size changes.
- Shrinking to enter narrow gaps and collision-limited growth in place.
- One collision solver shared by the client and the server, including movement corrections.
- A caret that follows actual displacement, including wall sliding and following.
- Real connected explorers, WebSocket presence, movement interpolation, and preset signals.
- Meet and follow actions across coordinates and depth.
- Individual square blocks that can be assembled and moved into arbitrary shapes. Confirmed edits are shared and persisted.
- Stone, glass, and glow materials, a placement grid, valid/blocked previews, and physical block collisions.
- Per-explorer removal permissions and generated names that survive a server restart.
- Named expeditions with separate presence, constructions, and signals.
- Invitation URLs that preserve the expedition, position, and scale.
- Responsive phone controls, keyboard navigation, reduced motion support, and an off-thread CPU terrain fallback.

## Boundaries of this version

Each expedition holds up to 32 explorers and 1,024 blocks. Depth is 0-18, about 262,144x from the surface. Terrain uses a fixed 512 iterations at every scale. Static collision cells come from the same fractal, with conservative padding and finer cells at smaller body sizes. Empty cells remain empty when refined, so a legal body can always shrink. Deep GPU rendering uses compensated float pairs; very fine boundary pixels can vary between devices. This is a finite geometric approximation.

This is a top-down, two-dimensional character controller. The fractal and placed blocks are solid; dark channels are traversable. The ring around your explorer is its physical footprint. Motion uses small collision-checked steps, with sliding along walls. Growth keeps the center fixed and stops before overlap. Other explorers are non-solid.

Blocks snap to a world grid at the nearest whole depth level. Their size stays fixed in world coordinates after placement. Each level halves the block size, so smaller building can add detail inside a larger construction. Place within six cells of your body. Cells cannot overlap fractal rock, existing blocks at any scale, or an explorer's body. All three materials are solid. Adjacent blocks at the same scale appear as a construction in **Build**, with a small map and a visit shortcut. Remove your own blocks at their scale and within reach. Placement has a 120 ms cooldown.

Drag your squares while building, or use **Move** to select a square and then a destination. Moves snap to the square's original grid and preserve its size, material, and ownership. Work at its scale and keep both endpoints within reach. The straight path must clear rock, other blocks, and explorers. A preview shows the destination; the original remains solid until release and server confirmation. Invalid drops and Escape leave it in place. Moves share the 120 ms placement cooldown and survive restarts. Zooming changes how large an existing square looks, not its physical dimensions.

Communication uses six fixed signals: hello, over here, follow, wait, go smaller, and thank you. The server accepts only these signal IDs, rate-limits them to one every three seconds per browser credential, and preserves that cooldown across reconnects. Free-form chat, custom explorer names, and landmark notes are removed. Extra text sent by a modified client is discarded. Expedition names remain invitation identifiers.

This is an anonymous, small-group prototype. Expedition names are identifiers, not access controls. Generated names, positions, signals, and blocks are visible to people in the same expedition. The last 60 signals remain in server memory. Persistent blocks are saved in `.local/<expedition>.json`; keep that directory if you want to keep your world. Ownership is held by a random browser-local token. Clearing browser storage loses the ability to remove earlier blocks. Earlier marker records are retained as `legacyMarks` when the file is next saved, and their text is never broadcast. An open public trial needs stronger identity and room controls.

## Optional self-hosting

The app needs one long-running Node.js process, WebSocket upgrade support, and a persistent writable directory. A static-file-only host cannot run the shared world.

Set `HOST=0.0.0.0`, `PORT` to the host's assigned port, and `FRACTICAL_DATA_DIR` to its persistent disk. Put the server behind HTTPS with the original Host header preserved for WebSocket upgrades. Run one replica: live rooms are held in that process. Multiple replicas need a coordinated room backend first.

`Dockerfile` builds the Astro frontend in a build stage and provides a Node runtime container. Mount a persistent volume at `/var/lib/fractical`. Its default port is 4173. Keep the data directory separate from the source repository.

The public source repository is [caustik/fractical](https://github.com/caustik/fractical). The source-sharing draft is in [POST.md](POST.md). [EXPERIMENT.md](EXPERIMENT.md) records the concept, playtest questions, and the next useful decisions.

The container is optional. Its build has not been verified here because the local Docker engine is not running.

## Verification and code

```powershell
npm test
```

Tests use real WebSocket connections against ephemeral local servers. They cover room isolation, movement and heading, preset signals, rejected free-form text, reconnect cooldowns, placement restrictions, concurrent persistence, ownership, server restarts, malformed coordinates, and cross-origin upgrade rejection.

Physics tests cover a real narrowing Mandelbrot passage, entry after shrinking, growth clamping without relocation, fast movement against a thin wall, wall sliding, refinement, and body bounds. Building tests cover primitive composition, collisions, growth limits, all caret directions, and placement over terrain or other bodies. A failed disk write never publishes a block or leaves a reserved cell behind.

Square-movement tests cover clear and blocked paths, tiny obstacles and explorers, fixed size, stale edits, ownership, restart recovery, and rollback after a failed save. The suite passes on Node.js 22. Headless browser checks cover desktop dragging, two-tap phone moves, touch dragging, keyboard moves, Escape cancellation, invalid drops, shared updates, zoom scaling, real-coast placement, and the 320-pixel phone layout.

| File                        | Owns                                                                          |
| --------------------------- | ----------------------------------------------------------------------------- |
| `server.mjs`                | HTTP, live rooms, persistence, and protocol validation                        |
| `src/pages/index.astro`     | Hand-maintained Astro page and UI markup                                     |
| `src/styles/global.css`     | Shared page and game styles                                                  |
| `src/integrations/world.mjs` | Development game server, same-origin proxy, and shutdown                      |
| `astro.config.mjs`          | Astro frontend configuration and `_site/` output                             |
| `public/world.mjs`          | Coordinates, depth, destinations, heading, generated names, and fixed signals |
| `public/physics.mjs`        | Solid cells, physical body, swept steps, growth, and safe landing             |
| `public/building.mjs`       | Block grid, materials, placement, spatial collisions, and connected shapes    |
| `public/app.mjs`            | Controls, camera, networking, invitations, and UI                             |
| `public/terrain.mjs`        | WebGL terrain and render quality                                              |
| `public/terrain-worker.mjs` | CPU fallback outside the interaction thread                                   |
| `public/entities.mjs`       | Explorers, blocks, placement previews, trails, and signals                    |
| `public/sound.mjs`          | Opt-in ambient audio                                                          |

The [ws documentation](https://github.com/websockets/ws) owns WebSocket behavior. [MDN's WebGL guidance](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices) describes GPU precision and device constraints. A later distributed version could use a room coordinator such as [Cloudflare Durable Objects](https://developers.cloudflare.com/workers/tutorials/deploy-a-realtime-chat-app/), but this version uses a single Node process.
