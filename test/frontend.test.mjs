import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import { dev } from "astro";
import { WebSocket } from "ws";
import { HOME } from "../public/world.mjs";

test(
  "Astro serves the frontend and same-origin live world, then closes both servers",
  { timeout: 15000 },
  async () => {
    const qaRoot = path.resolve(".qa");
    await mkdir(qaRoot, { recursive: true });
    const dataDir = await mkdtemp(path.join(qaRoot, "frontend-"));
    const previousDataDir = process.env.FRACTICAL_DATA_DIR;
    process.env.FRACTICAL_DATA_DIR = dataDir;
    let server, socket;
    try {
      server = await dev({
        root: process.cwd(),
        server: { host: "127.0.0.1", port: 0 },
        logLevel: "error",
        devToolbar: { enabled: false },
      });
      const origin = `http://127.0.0.1:${server.address.port}`;
      const page = await fetch(origin);
      assert.equal(page.status, 200);
      assert.match(await page.text(), /Interactive shared fractal world/);
      assert.equal((await (await fetch(`${origin}/health`)).json()).ok, true);
      socket = new WebSocket(origin.replace("http:", "ws:") + "/live", {
        origin,
      });
      await once(socket, "open");
      const welcome = once(socket, "message");
      socket.send(
        JSON.stringify({ type: "join", room: "frontend-test", ...HOME }),
      );
      assert.equal(JSON.parse((await welcome)[0]).type, "welcome");
      const rejected = new WebSocket(origin.replace("http:", "ws:") + "/live", {
        origin: "https://another-origin.invalid",
      });
      await new Promise((resolve, reject) => {
        rejected.once("error", resolve);
        rejected.once("open", () =>
          reject(new Error("Cross-origin connection accepted")),
        );
      });
      const closed = once(socket, "close");
      await server.stop();
      await closed;
      server = null;
      await assert.rejects(fetch(`${origin}/health`));
    } finally {
      socket?.terminate();
      await server?.stop();
      if (previousDataDir === undefined) delete process.env.FRACTICAL_DATA_DIR;
      else process.env.FRACTICAL_DATA_DIR = previousDataDir;
      assert.ok(path.resolve(dataDir).startsWith(qaRoot + path.sep));
      await rm(dataDir, { recursive: true, force: true });
    }
  },
);
