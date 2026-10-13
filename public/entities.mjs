import { spanAt, PLACES } from "./world.mjs";
import { bodyRadiusAt, PASSAGE } from "./physics.mjs";
import {
  MATERIALS,
  BUILD_REACH,
  blockSizeAt,
  blockPosition,
  cellAt,
} from "./building.mjs";

export class Entities {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.trails = [];
    this.hitAreas = [];
  }
  resize(width, height) {
    this.width = width;
    this.height = height;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }
  point(position, camera) {
    const scale = this.height / spanAt(camera.depth);
    return {
      x: this.width / 2 + (position.x - camera.x) * scale,
      y: this.height / 2 - (position.y - camera.y) * scale,
    };
  }
  hit(x, y) {
    return this.hitAreas
      .slice()
      .reverse()
      .find((area) =>
        area.bounds
          ? x >= area.bounds.minX &&
            x <= area.bounds.maxX &&
            y >= area.bounds.minY &&
            y <= area.bounds.maxY
          : Math.hypot(x - area.x, y - area.y) < area.radius,
      );
  }
  draw({
    camera,
    me,
    others,
    blocks,
    waves,
    bubbles,
    destination,
    time,
    reduceMotion,
    physicsState,
    buildPreview,
  }) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    this.hitAreas = [];
    const myPoint = this.point(me, camera);
    const crowd = others
      .filter((player) => {
        const p = this.point(player, camera);
        return (
          Math.hypot(p.x - myPoint.x, p.y - myPoint.y) < 38 &&
          Math.abs(player.depth - me.depth) < 2
        );
      })
      .sort((a, b) => a.id.localeCompare(b.id));
    // A subtle survey grid uses world coordinates so it moves with the coast.
    const cell = spanAt(Math.floor(camera.depth)) / 4;
    const spacing = (cell / spanAt(camera.depth)) * this.height;
    const startX = this.width / 2 - ((camera.x % cell) / cell) * spacing;
    const startY = this.height / 2 + ((camera.y % cell) / cell) * spacing;
    ctx.strokeStyle = "#dbe6c50c";
    ctx.lineWidth = 0.6;
    for (let x = startX % spacing; x < this.width; x += spacing) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.height);
      ctx.stroke();
    }
    for (let y = startY % spacing; y < this.height; y += spacing) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.width, y);
      ctx.stroke();
    }
    for (const place of PLACES) {
      const p = this.point(place, camera);
      if (Math.hypot(p.x - myPoint.x, p.y - myPoint.y) < 60) continue;
      if (
        p.x < -60 ||
        p.y < -60 ||
        p.x > this.width + 60 ||
        p.y > this.height + 60 ||
        Math.abs(camera.depth - place.depth) > 2.5
      )
        continue;
      ctx.strokeStyle = "#d8dab565";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 20, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 27, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      if (
        Math.hypot(p.x - myPoint.x, p.y - myPoint.y) > 90 &&
        !blocks.some((block) => {
          const m = this.point(block, camera);
          return Math.hypot(p.x - m.x, p.y - m.y) < 70;
        })
      )
        this.label(place.name, p.x, p.y + 42, "#bac9ae", 10);
    }
    if (me.moving && time - (this.lastTrail || 0) > 130) {
      this.trails.push({ x: me.x, y: me.y, depth: me.depth, time });
      this.lastTrail = time;
    }
    this.trails = this.trails
      .filter((item) => time - item.time < 3800)
      .slice(-32);
    for (const trail of this.trails) {
      if (Math.abs(trail.depth - camera.depth) > 1.5) continue;
      const p = this.point(trail, camera);
      ctx.fillStyle = `rgba(231,180,109,${(1 - (time - trail.time) / 3800) * 0.3})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    if (destination) {
      const from = this.point(me, camera),
        to = this.point(destination, camera);
      ctx.strokeStyle = "#cbd7ba55";
      ctx.lineWidth = 0.8;
      ctx.setLineDash([2, 6]);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = "#d9dfba88";
      ctx.beginPath();
      ctx.arc(to.x, to.y, 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(to.x - 12, to.y);
      ctx.lineTo(to.x + 12, to.y);
      ctx.moveTo(to.x, to.y - 12);
      ctx.lineTo(to.x, to.y + 12);
      ctx.stroke();
    }
    const passage = this.point(PASSAGE, camera);
    if (
      camera.depth < 9 &&
      passage.x > 30 &&
      passage.x < this.width - 30 &&
      passage.y > 110 &&
      passage.y < this.height - 60 &&
      Math.hypot(passage.x - myPoint.x, passage.y - myPoint.y) > 35
    ) {
      ctx.strokeStyle = "#e7b46dbb";
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.arc(passage.x, passage.y, 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      this.label("THE NARROWS", passage.x, passage.y + 27, "#efdbb6", 10);
      this.label(
        "GO SMALLER TO ENTER",
        passage.x,
        passage.y + 40,
        "#d6cba7",
        8,
      );
      this.hitAreas.push({
        x: passage.x,
        y: passage.y,
        radius: 24,
        kind: "passage",
        value: PASSAGE,
      });
    }
    if (buildPreview) {
      const level = Math.round(me.depth),
        size = blockSizeAt(level),
        pixel = (size / spanAt(camera.depth)) * this.height;
      const center = cellAt(me, level);
      ctx.strokeStyle = "#d7e9c930";
      ctx.lineWidth = 0.7;
      for (
        let iy = center.iy - BUILD_REACH;
        iy <= center.iy + BUILD_REACH;
        iy++
      ) {
        for (
          let ix = center.ix - BUILD_REACH;
          ix <= center.ix + BUILD_REACH;
          ix++
        ) {
          const cell = { ix, iy, depth: level },
            position = blockPosition(cell);
          if (
            Math.hypot(position.x - me.x, position.y - me.y) >
            size * BUILD_REACH
          )
            continue;
          const p = this.point(position, camera);
          ctx.strokeRect(p.x - pixel / 2, p.y - pixel / 2, pixel, pixel);
        }
      }
      ctx.strokeStyle = "#d7e9c955";
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.arc(myPoint.x, myPoint.y, pixel * BUILD_REACH, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const block of blocks) {
      const p = this.point(block, camera),
        pixel = (blockSizeAt(block.depth) / spanAt(camera.depth)) * this.height;
      const left = p.x - pixel / 2,
        top = p.y - pixel / 2;
      if (
        left > this.width ||
        top > this.height ||
        left + pixel < 0 ||
        top + pixel < 0
      )
        continue;
      const material = MATERIALS[block.material];
      ctx.save();
      ctx.fillStyle = material.fill;
      ctx.strokeStyle = material.edge;
      ctx.lineWidth = Math.max(0.5, Math.min(1.5, pixel / 15));
      if (block.material === "glow") {
        ctx.shadowColor = material.edge;
        ctx.shadowBlur = Math.min(18, pixel / 2);
      }
      ctx.fillRect(left, top, Math.max(0.7, pixel), Math.max(0.7, pixel));
      if (pixel > 3) {
        ctx.strokeRect(left + 0.5, top + 0.5, pixel - 1, pixel - 1);
        ctx.shadowBlur = 0;
        if (block.material === "glass") {
          ctx.beginPath();
          ctx.moveTo(left + pixel * 0.2, top + pixel * 0.6);
          ctx.lineTo(left + pixel * 0.6, top + pixel * 0.2);
          ctx.stroke();
        } else {
          ctx.fillStyle = "#fff4ce20";
          ctx.fillRect(
            left + 2,
            top + 2,
            Math.max(0, pixel - 4),
            Math.min(3, pixel / 6),
          );
          ctx.fillStyle = "#0a252330";
          ctx.fillRect(
            left + 2,
            top + pixel - Math.min(4, pixel / 5),
            Math.max(0, pixel - 4),
            Math.min(2, pixel / 8),
          );
        }
      }
      ctx.restore();
      this.hitAreas.push({
        x: p.x,
        y: p.y,
        kind: "block",
        value: block,
        bounds: {
          minX: left,
          minY: top,
          maxX: left + pixel,
          maxY: top + pixel,
        },
      });
    }
    if (buildPreview?.cell) {
      const p = this.point(blockPosition(buildPreview.cell), camera),
        pixel =
          (blockSizeAt(buildPreview.cell.depth) / spanAt(camera.depth)) *
          this.height;
      ctx.fillStyle = buildPreview.allowed ? "#b8e5be55" : "#f1a28055";
      ctx.strokeStyle = buildPreview.allowed ? "#d9f3c5" : "#ffc0a0";
      ctx.lineWidth = 2;
      ctx.fillRect(p.x - pixel / 2, p.y - pixel / 2, pixel, pixel);
      ctx.strokeRect(p.x - pixel / 2, p.y - pixel / 2, pixel, pixel);
      this.label(
        buildPreview.erase
          ? "REMOVE"
          : buildPreview.allowed
            ? "PLACE"
            : "BLOCKED",
        p.x,
        p.y - pixel / 2 - 11,
        ctx.strokeStyle,
        9,
      );
    }
    const players = [...others, me];
    for (const player of players) {
      const p = this.point(player, camera),
        mine = player.id === me.id,
        difference = camera.depth - player.depth;
      const crowdIndex = crowd.findIndex((item) => item.id === player.id);
      if (!mine && crowdIndex >= 0) {
        const angle = crowdIndex * 2.4 + 0.5;
        p.x += Math.cos(angle) * 29;
        p.y += Math.sin(angle) * 29;
      }
      if (
        p.x < -60 ||
        p.y < -60 ||
        p.x > this.width + 60 ||
        p.y > this.height + 60
      )
        continue;
      const physicalRadius =
        (bodyRadiusAt(player.depth) / spanAt(camera.depth)) * this.height;
      const size = mine
        ? physicalRadius / 13
        : Math.min(1.7, Math.max(0.25, physicalRadius / 13));
      if (mine) {
        ctx.strokeStyle = physicsState ? "#e7b46ddd" : "#ece8c7a0";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, physicalRadius, 0, Math.PI * 2);
        ctx.stroke();
      }
      const wave = waves.get(player.id);
      if (wave && time - wave < 3000) {
        const progress = (time - wave) / 3000;
        ctx.strokeStyle = player.color;
        ctx.globalAlpha = (1 - progress) * 0.7;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 15 + progress * 65, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(size, size);
      ctx.shadowColor = "#071e24";
      ctx.shadowBlur = 8;
      const bob =
        player.moving && !reduceMotion ? Math.sin(time * 0.016) * 1.7 : 0;
      ctx.fillStyle = "#04252c66";
      ctx.beginPath();
      ctx.ellipse(0, 9, 8, 3.5, 0, 0, Math.PI * 2);
      ctx.fill();
      // Boots, coat, backpack, and head keep the explorer readable at a human scale.
      ctx.fillStyle = "#152c2c";
      ctx.beginPath();
      ctx.roundRect(-4, 4 + bob, 3, 6, 1);
      ctx.roundRect(1, 4 - bob, 3, 6, 1);
      ctx.fill();
      ctx.fillStyle = player.color;
      ctx.strokeStyle = "#f1ecc8bb";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.roundRect(-6, -5 + bob * 0.35, 12, 13, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#40564a";
      ctx.beginPath();
      ctx.roundRect(-4, 0 + bob * 0.35, 8, 6, 2);
      ctx.fill();
      ctx.fillStyle = "#ede6c5";
      ctx.beginPath();
      ctx.arc(0, -8 + bob * 0.35, 4.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = player.color;
      ctx.beginPath();
      ctx.ellipse(0, -9 + bob * 0.35, 5.8, 2.3, 0, 0, Math.PI * 2);
      ctx.fill();
      if (player.moving) {
        ctx.rotate(player.heading);
        ctx.strokeStyle = player.color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, -25);
        ctx.lineTo(-3, -20);
        ctx.moveTo(0, -25);
        ctx.lineTo(3, -20);
        ctx.stroke();
      }
      ctx.restore();
      if (mine || crowd.length <= 3 || crowdIndex < 0)
        this.label(
          mine ? "YOU" : player.name,
          p.x,
          p.y + (mine ? 29 : -29) * size,
          mine ? "#ecdab0" : "#d3dfc0",
          mine ? 9 : 10,
        );
      if (!mine && Math.abs(difference) > 0.7)
        this.label(
          `depth ${player.depth.toFixed(1)}`,
          p.x,
          p.y - 42 * size,
          "#9bb2a0",
          9,
        );
      if (!mine)
        this.hitAreas.push({
          x: p.x,
          y: p.y,
          radius: 18 * size,
          kind: "player",
          value: player,
        });
      const bubble = bubbles.get(player.id);
      if (bubble && time - bubble.time < 6000)
        this.speech(bubble.text, p.x, p.y - 30 * size);
    }
    if (crowd.length > 3)
      this.label(
        `${crowd.length} EXPLORERS NEARBY`,
        myPoint.x,
        myPoint.y + 44,
        "#d3dfc0",
        9,
      );
  }
  label(text, x, y, color, size) {
    const ctx = this.ctx;
    ctx.font = `${size}px ${size === 8 ? "Courier New" : "Arial"}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "#092b30";
    ctx.shadowBlur = 5;
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.shadowBlur = 0;
  }
  speech(text, x, y) {
    const ctx = this.ctx;
    ctx.font = "10px Arial";
    const shown = text.length > 50 ? text.slice(0, 47) + "…" : text;
    const width = Math.min(290, ctx.measureText(shown).width + 20);
    const left = Math.max(8, Math.min(this.width - width - 8, x - width / 2));
    ctx.fillStyle = "#efefdcf0";
    ctx.beginPath();
    ctx.roundRect(left, y - 28, width, 25, 5);
    ctx.fill();
    ctx.fillStyle = "#193637";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(shown, left + width / 2, y - 15);
  }
}
