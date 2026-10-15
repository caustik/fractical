import { defineConfig } from "astro/config";
import world from "./src/integrations/world.mjs";

export default defineConfig({
  outDir: "./_site",
  integrations: [world()],
  server: { host: "127.0.0.1", port: 4173 },
});
