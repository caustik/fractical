# Fractical: a small experiment in shared infinity

I've been playing with a question: what if a fractal were a place we could visit together?

Fractical is a small browser experiment where the Mandelbrot shape defines solid geometry. Your character occupies space. When an opening is too small, shrink until you fit, then enter and explore. Growing again only works where there is room for the larger body.

You can meet other explorers in real time and assemble your own structures from individual stone, glass, and glow blocks. The blocks are solid, shared live, and stay after you leave. Communication uses a handful of preset signals; explorer names are generated.

Source: **[caustik/fractical](https://github.com/caustik/fractical)**

It runs locally with Node.js 22 or newer. Clone the repository, then run:

```sh
npm ci --ignore-scripts
npm start
```

Open `http://127.0.0.1:4173` in your browser. The README explains how to connect another computer or phone on your network. Everyone in a playtest connects to the same server. Self-hosting instructions and a Dockerfile are included if you want to deploy your own instance.

Start by walking towards the narrowing passage. Let the rock stop you, go smaller to fit, then try growing inside the gap. Find another opening together. Press B and build a wall or a shape of your own, one block at a time.

WASD or the arrow keys move. E shrinks; Q grows when there is room. On a phone, use the walking pad and the + / - controls. The Together panel lets you meet or follow another explorer.

This is an early top-down prototype with finite collision geometry and bounded depth. I'm interested in whether physically fitting through finer detail can make a fractal feel like a place, and whether other people's traces make you want to return.

If you try it, I'd love to hear:

- Where did you go, and what did you build?
- Did shrinking to enter an opening feel natural?
- Could you tell why growth was blocked?
- What would make you want to go back with someone?

---

Sharing note: a localhost invitation works only on the computer running the prototype; multiplayer invitations need an address the other players can reach.
