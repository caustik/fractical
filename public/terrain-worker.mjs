import { escapeIterations } from './physics.mjs';

// The light renderer stays off the interaction thread, including at deep zoom.
self.addEventListener('message', (event) => {
  const { camera, width, height, span, max } = event.data;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const cx = camera.x + ((x + 0.5 - width / 2) / height) * span;
      const cy = camera.y - ((y + 0.5 - height / 2) / height) * span;
      const n = escapeIterations(cx, cy, max),
        i = (y * width + x) * 4;
      let rgb;
      if (n >= max) {
        const terrain = (Math.sin(cx * 13 + cy * 8) * 0.5 + 0.5) * 0.6;
        rgb = [150 + 28 * terrain, 153 + 20 * terrain, 112 + 15 * terrain];
      } else {
        const water = 1 - Math.exp(-Math.max(n, 0) * 0.09);
        const coast = (1 - Math.exp(-Math.max(n - 17, 0) * 0.025)) * 0.75;
        const f = (((n * 0.22) % 1) + 1) % 1,
          contour = Math.max(0, 1 - Math.abs(f - 0.5) / 0.07);
        rgb = [
          9 + 55 * water + 42 * contour * water,
          38 + 82 * water + 61 * contour * water,
          43 + 56 * water + 42 * contour * water,
        ];
        rgb = rgb.map((v, j) => v * (1 - coast) + [199, 176, 110][j] * coast);
      }
      pixels[i] = rgb[0];
      pixels[i + 1] = rgb[1];
      pixels[i + 2] = rgb[2];
      pixels[i + 3] = 255;
    }
  self.postMessage({ width, height, camera, pixels: pixels.buffer }, [
    pixels.buffer,
  ]);
});
