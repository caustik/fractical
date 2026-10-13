import { spanAt } from './world.mjs';
import { TERRAIN_ITERATIONS } from './physics.mjs';

const vertex = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;
const fragment = `#version 300 es
precision highp float;
precision highp int;
uniform vec2 resolution;
uniform vec2 centerHi;
uniform vec2 centerLo;
uniform float span;
uniform int iterations;
uniform bool deep;
uniform highp uint roundMask;
out vec4 outputColor;
// The runtime mask is all ones. The bitwise boundary prevents drivers from
// reassociating the error terms into zero or merging multiply/add operations.
// A pragma alone does not preserve compensated arithmetic in WebGL drivers.
float rounded(float v) { return uintBitsToFloat(floatBitsToUint(v) & roundMask); }
vec2 dsadd(vec2 a, vec2 b) {
  float s = rounded(a.x + b.x);
  float v = rounded(s - a.x);
  float t = rounded(rounded(b.x - v) + rounded(a.x - rounded(s - v)));
  t = rounded(t + rounded(a.y + b.y));
  float r = rounded(s + t);
  return vec2(r, rounded(t - rounded(r - s)));
}
vec2 dsmul(vec2 a, vec2 b) {
  float ca = rounded(4097.0 * a.x);
  float ah = rounded(ca - rounded(ca - a.x));
  float al = rounded(a.x - ah);
  float cb = rounded(4097.0 * b.x);
  float bh = rounded(cb - rounded(cb - b.x));
  float bl = rounded(b.x - bh);
  float p = rounded(a.x * b.x);
  float e = rounded(rounded(ah * bh) - p);
  e = rounded(e + rounded(ah * bl));
  e = rounded(e + rounded(al * bh));
  e = rounded(e + rounded(al * bl));
  e = rounded(e + rounded(a.x * b.y));
  e = rounded(e + rounded(a.y * b.x));
  float r = rounded(p + e);
  return vec2(r, rounded(e - rounded(r - p)));
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * resolution) / resolution.y;
  vec2 offset = uv * span;
  vec2 c = centerHi + centerLo + offset;
  vec2 z = vec2(0.0);
  vec2 derivative = vec2(0.0);
  vec2 cx = dsadd(vec2(centerHi.x, centerLo.x), vec2(offset.x, 0.0));
  vec2 cy = dsadd(vec2(centerHi.y, centerLo.y), vec2(offset.y, 0.0));
  vec2 zx = vec2(0.0), zy = vec2(0.0);
  float n = 0.0;
  float q = (c.x - 0.25) * (c.x - 0.25) + c.y * c.y;
  bool inside = q * (q + c.x - 0.25) <= 0.25 * c.y * c.y || dot(c + vec2(1.0, 0.0), c + vec2(1.0, 0.0)) <= 0.0625;
  if (!inside) {
    for (int i = 0; i < 768; i++) {
      if (i >= iterations) { inside = true; break; }
      derivative = vec2(2.0 * (z.x * derivative.x - z.y * derivative.y) + 1.0, 2.0 * (z.x * derivative.y + z.y * derivative.x));
      if (deep) {
        vec2 xx = dsmul(zx, zx), yy = dsmul(zy, zy);
        vec2 xy = dsmul(zx, zy);
        zy = dsadd(dsadd(xy, xy), cy);
        zx = dsadd(dsadd(xx, -yy), cx);
        z = vec2(zx.x + zx.y, zy.x + zy.y);
      } else { z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c; }
      if (dot(z,z) > 256.0) { n = float(i) + 1.0 - log2(log2(length(z))); break; }
    }
  }
  vec3 color;
  if (inside) {
    float terrain = sin(c.x * 13.0 + c.y * 8.0) * 0.5 + 0.5;
    color = mix(vec3(0.59, 0.60, 0.44), vec3(0.70, 0.68, 0.50), terrain * 0.6);
    color += (hash(gl_FragCoord.xy) - 0.5) * 0.012;
  } else {
    float water = 1.0 - exp(-max(n, 0.0) * 0.09);
    color = mix(vec3(0.035, 0.15, 0.17), vec3(0.25, 0.47, 0.39), water);
    float contour = 1.0 - smoothstep(0.015, 0.07, abs(fract(n * 0.22) - 0.5));
    float fine = 1.0 - smoothstep(0.015, 0.035, abs(fract(n * 0.66) - 0.5));
    color *= 0.85 + 0.15 * cos(n * 0.24);
    color += vec3(0.20, 0.29, 0.20) * contour * (0.35 + water * 0.45);
    color += vec3(0.09, 0.14, 0.11) * fine * water * 0.3;
    float coast = 1.0 - exp(-max(n - 17.0, 0.0) * 0.025);
    color = mix(color, vec3(0.78, 0.69, 0.43), coast * 0.75);
    float distanceEstimate = length(z) * log(length(z)) / max(length(derivative), 1.0);
    float edge = exp(-distanceEstimate / (span / resolution.y * 3.0));
    color += vec3(0.18, 0.16, 0.07) * edge * 0.5;
    color += (hash(gl_FragCoord.xy) - 0.5) * 0.006;
  }
  outputColor = vec4(color, 1.0);
}
`;

export class Terrain {
  constructor(canvas, onNotice) {
    this.canvas = canvas;
    this.onNotice = onNotice;
    this.gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: false,
      preserveDrawingBuffer: false,
    });
    this.last = null;
    this.quality = 0.9;
    if (this.gl) {
      try {
        this.initialize();
        this.mode = 'webgl2';
      } catch (error) {
        console.warn('GPU terrain unavailable:', error.message);
        this.useFallback();
      }
      canvas.addEventListener('webglcontextlost', (event) => {
        event.preventDefault();
        this.last = null;
        onNotice('Graphics paused. Waiting for the terrain to return.');
        this.lost = true;
      });
      canvas.addEventListener('webglcontextrestored', () => {
        this.lost = false;
        this.initialize();
        this.last = null;
        onNotice('');
      });
    } else this.useFallback();
  }
  initialize() {
    const gl = this.gl;
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return shader;
    };
    const vs = compile(gl.VERTEX_SHADER, vertex),
      fs = compile(gl.FRAGMENT_SHADER, fragment);
    this.program = gl.createProgram();
    gl.attachShader(this.program, vs);
    gl.attachShader(this.program, fs);
    gl.bindAttribLocation(this.program, 0, 'position');
    gl.linkProgram(this.program);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS))
      throw new Error(
        gl.getShaderInfoLog(fs) || gl.getProgramInfoLog(this.program),
      );
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    gl.useProgram(this.program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.uniforms = Object.fromEntries(
      [
        'resolution',
        'centerHi',
        'centerLo',
        'span',
        'iterations',
        'deep',
        'roundMask',
      ].map((name) => [name, gl.getUniformLocation(this.program, name)]),
    );
  }
  useFallback() {
    this.mode = 'cpu';
    // A canvas that requested WebGL cannot also provide a 2D context.
    const replacement = document.createElement('canvas');
    replacement.id = this.canvas.id;
    replacement.setAttribute('aria-label', 'Mandelbrot terrain');
    this.canvas.replaceWith(replacement);
    this.canvas = replacement;
    this.ctx = replacement.getContext('2d');
    this.buffer = document.createElement('canvas');
    this.bufferCtx = this.buffer.getContext('2d');
    this.worker = new Worker('/terrain-worker.mjs', { type: 'module' });
    this.worker.addEventListener('message', (event) => {
      const { width, height, pixels, camera } = event.data;
      this.buffer.width = width;
      this.buffer.height = height;
      this.bufferCtx.putImageData(
        new ImageData(new Uint8ClampedArray(pixels), width, height),
        0,
        0,
      );
      this.bufferCamera = camera;
      this.reproject(this.currentCamera || camera);
      this.rendering = false;
      this.painted = true;
      if (this.pending) {
        const pending = this.pending;
        this.pending = null;
        this.draw(pending);
      }
    });
    this.worker.addEventListener('error', () =>
      this.onNotice('The terrain could not load. Reload to try again.'),
    );
    this.onNotice('Using a lighter terrain renderer on this device.');
  }
  resize(width, height) {
    this.width = width;
    this.height = height;
    const pixels = Math.min(window.devicePixelRatio || 1, 1.5) * this.quality;
    this.canvas.width = Math.max(1, Math.round(width * pixels));
    this.canvas.height = Math.max(1, Math.round(height * pixels));
    this.last = null;
  }
  reproject(camera) {
    this.currentCamera = { ...camera };
    if (this.mode !== 'cpu' || !this.bufferCamera) return;
    const span = spanAt(camera.depth);
    const height =
      (this.canvas.height * spanAt(this.bufferCamera.depth)) / span;
    const width = (height * this.buffer.width) / this.buffer.height;
    const x =
      this.canvas.width / 2 +
      ((this.bufferCamera.x - camera.x) * this.canvas.height) / span;
    const y =
      this.canvas.height / 2 -
      ((this.bufferCamera.y - camera.y) * this.canvas.height) / span;
    this.ctx.fillStyle = '#102d30';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.drawImage(
      this.buffer,
      x - width / 2,
      y - height / 2,
      width,
      height,
    );
  }
  draw(camera) {
    if (this.lost || !this.width || !this.height) return;
    const span = spanAt(camera.depth);
    this.currentCamera = { ...camera };
    if (
      this.last &&
      Math.abs(camera.x - this.last.x) + Math.abs(camera.y - this.last.y) <
        (span / this.height) * 0.15 &&
      Math.abs(camera.depth - this.last.depth) < 0.0004
    )
      return;
    const max = TERRAIN_ITERATIONS;
    if (this.gl && this.mode === 'webgl2') {
      const gl = this.gl,
        u = this.uniforms;
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.useProgram(this.program);
      gl.uniform2f(u.resolution, this.canvas.width, this.canvas.height);
      const hiX = Math.fround(camera.x),
        hiY = Math.fround(camera.y);
      gl.uniform2f(u.centerHi, hiX, hiY);
      gl.uniform2f(u.centerLo, camera.x - hiX, camera.y - hiY);
      gl.uniform1f(u.span, span);
      gl.uniform1i(u.iterations, max);
      gl.uniform1i(u.deep, camera.depth > 9 ? 1 : 0);
      gl.uniform1ui(u.roundMask, 0xffffffff);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.painted = true;
    } else {
      if (this.rendering) {
        this.pending = { ...camera };
        return false;
      }
      const width = Math.max(1, Math.min(360, Math.round(this.width * 0.45)));
      const height = Math.max(
        1,
        Math.round((width * this.height) / this.width),
      );
      this.rendering = true;
      this.worker.postMessage({
        camera: { ...camera },
        width,
        height,
        span,
        max,
      });
    }
    this.last = { ...camera };
    return true;
  }
}
