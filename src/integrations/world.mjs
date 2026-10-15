import { createFracticalServer } from "../../server.mjs";

// Astro owns development HTTP and hot reload; the same game server used in
// production owns rooms, persistence, and the WebSocket protocol.
export default function world() {
  let game;
  const close = async () => {
    const current = game;
    game = null;
    await current?.close();
  };
  return {
    name: "fractical-world",
    hooks: {
      "astro:config:setup": async ({ command, updateConfig, logger }) => {
        if (command !== "dev") return;
        game = await createFracticalServer({
          port: 0,
          ...(process.env.FRACTICAL_DATA_DIR
            ? { dataDir: process.env.FRACTICAL_DATA_DIR }
            : {}),
        });
        logger.info(
          "Live world ready at /live; persistent rooms use the game server.",
        );
        updateConfig({
          vite: {
            server: {
              proxy: {
                // Preserve Host and Origin so the game's origin check also
                // protects the development WebSocket connection.
                "^/live(?:\\?|$)": {
                  target: game.url,
                  ws: true,
                  changeOrigin: false,
                },
                "^/health(?:\\?|$)": { target: game.url, changeOrigin: false },
              },
            },
            plugins: [{ name: "fractical-world-cleanup", closeBundle: close }],
          },
        });
      },
      "astro:server:done": close,
    },
  };
}
