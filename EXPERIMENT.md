# Fractical, experiment 001

## The idea

The fractal defines solid geometry. Your character has a body that occupies space. If an opening is too small, shrink until the body fits, then walk into it. To become larger again, find enough clear space for the larger body. The rock stops growth that would cause overlap.

The core loop is **find an opening -> approach it -> shrink to fit -> enter and explore -> return to open space and grow**. Changing scale is part of navigating the shape. A small region becomes a place you can physically inhabit.

Shared explorers and persistent building extend that loop: find something, assemble a place from blocks, and bring someone back.

## Physical model

The prototype uses a top-down, two-dimensional view. Warm stone is solid; the dark channels are traversable. The ring around your explorer is its circular collision body. Its radius in world coordinates halves for every extra level of depth. The camera zooms with the body, keeping the explorer legible while openings become large enough to enter.

The Mandelbrot calculation generates static collision cells. Motion advances in small checked steps and slides along walls. Shrinking refines the geometry. Empty cells remain empty when subdivided, so reducing a legal body's size preserves room to fit. Growing tests the larger footprint at the same center and stops at the last legal size.

The client and server run the same solver. The server corrects moves through rock and denies growth into occupied space. Geometry uses a fixed iteration budget and conservative finite cells; very small details have a practical resolution limit.

Discover, Home, Meet, invitations, and construction visits relocate to clear ground. Following uses the movement and size constraints. Double-clicking shrinks in place and walks towards the point. Other explorers are non-solid. Placed blocks are solid and constrain both movement and growth.

## Building and communication

Building uses individual square primitives on a grid at the explorer's current scale. Stone, glass, and glow change the material of a cell. People compose their own walls, openings, and shapes one block at a time. Smaller blocks can add detail at finer scales. Placement rejects occupied geometry and preserves room for every connected explorer. Builders can drag their squares or select a square and a destination with Move. Moves preserve the original world size and require a clear path. Squares grow or shrink on screen with the camera. Confirmed edits are shared live, persist across restarts, and can be removed by their builder.

People communicate with fixed signals: hello, over here, follow, wait, go smaller, and thank you. There is no free-form chat or public text annotation. Explorer names are generated. The server validates signal IDs and applies a cooldown that survives reconnects. This keeps language predictable while preserving ways to coordinate movement and building.

## First playtest

Try two to six people in one expedition. Run one local server and have participants connect to its network address using the README's LAN instructions. Start with the narrowing passage:

1. Choose **Try the opening** in Discover, or click the **THE NARROWS** marker. Watch the body stop before the opening.
2. Hold **E** while the walking route remains selected. Shrinking should let you enter.
3. Inside, hold **Q**. Notice that growth stops without moving the body out of the gap.
4. Walk towards open space, then try growing again.
5. Press **B** and build a wall from nearby cells. Drag a square to change the opening, then try walking and growing through it. Zoom to compare its size with your body. Invite another explorer to add their own blocks.
6. Follow another explorer through a route they discovered.

Let people attempt the first opening before explaining the controls. Watch whether collision feedback makes them infer the role of scale. The first session needs observations and voluntary feedback; no analytics service is included.

## What to learn

| Question                                          | Useful evidence                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Does size feel like a physical property?          | People shrink when blocked and grow when they reach open space.                      |
| Are collisions understandable?                    | They can identify the rock, their body's footprint, and why growth stops.            |
| Does entering finer detail feel like exploration? | People find their own openings and keep going beyond the guided passage.             |
| Can people navigate together at different sizes?  | They follow a route, wait for one another, and explain how to fit through a gap.     |
| Does building create attachment?                  | Somebody returns to a shape they assembled or adds to another person's construction. |

## Boundaries

This pass tests a circular character against a planar fractal and square building primitives. It has no gravity, jumping, momentum simulation, or three-dimensional terrain. Blocks can be placed at different scales, with a reach and population limit. This is a first test of composing physical structures together.

The important invariant is that a legal body fits in the generated geometry: movement cannot place it inside rock, shrinking preserves clearance, and growth cannot force an overlap. The physics tests cover that invariant on a real Mandelbrot opening and on thin-wall fixtures. Server tests check the same constraints over real connections.

## Next decisions, based on the playtest

- If rock and open space are hard to distinguish, improve their visual separation and contact feedback before adding more mechanics.
- If blocked growth feels like a broken control, show a brief outline of the requested larger body and its contact points.
- If paths become hard to retrace, add a physical return trail or a few size anchors.
- If people mostly use relocations, test a session that emphasizes ordinary walking and following.
- If primitive building feels rewarding, test a faster painting tool, a few more primitive shapes, and construction permissions for trusted groups.
- If a three-dimensional view helps people understand space, test one bounded extrusion or volumetric fractal with matching collider geometry.
- If public participation holds attention, choose the host, room moderation model, and durable room backend.

## What success looks like

Someone reaches an opening, realizes they need to become smaller, enters, then sends the "Over here!" signal. Another person follows the physical route into that place. They make a shape together from individual blocks and return to it later.
