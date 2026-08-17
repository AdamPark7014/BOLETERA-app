import type { Camera } from './camera';
import { rgbaToCss } from './colors';
import { collectGridLines, computeGridSpec, formatMeters } from './grid';
import { mapToMeters } from '../geometry/snaps';
import type { LodController } from './lod';
import type { LayerStack } from './layers';
import type { SceneBuffers } from './scene-buffers';
import type { AnalysisOverlay, InteractionOverlay, LodLevel } from './types';

export type OverlayDrawContext = {
  camera: Camera;
  scene: SceneBuffers;
  layers: LayerStack;
  lod: LodLevel;
  lodController: LodController;
  visible: Uint32Array;
  visibleCount: number;
  analysis?: AnalysisOverlay[];
  interaction?: InteractionOverlay | null;
  background: string;
  frameStart: number;
  budgetMs: number;
};

/**
 * Canvas2D path used both as WebGL overlay (grid/labels/vectors) and as
 * full fallback when WebGL2 is unavailable.
 */
export class Canvas2DRenderer {
  constructor(private readonly ctx: CanvasRenderingContext2D) {}

  resize(camera: Camera): void {
    const { width, height } = camera.bufferSize();
    const canvas = this.ctx.canvas;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  /** Full-scene fallback draw (no WebGL). */
  drawAll(ctx: OverlayDrawContext, clear = true): number {
    const { camera } = ctx;
    this.resize(camera);
    const c = this.ctx;
    c.setTransform(camera.dpr, 0, 0, camera.dpr, 0, 0);
    if (clear) {
      c.fillStyle = ctx.background;
      c.fillRect(0, 0, camera.width, camera.height);
    }

    let drawCalls = 0;
    if (ctx.layers.isVisible('sections') && ctx.lod !== 'seats') {
      drawCalls += this.drawSections(ctx);
    }
    if (ctx.layers.isVisible('rows') && ctx.lod === 'rows') {
      drawCalls += this.drawRows(ctx);
    }
    if (ctx.layers.isVisible('seats') && ctx.lod === 'seats') {
      drawCalls += this.drawSeats(ctx);
    }
    if (ctx.layers.isVisible('stage')) drawCalls += this.drawStage(ctx);
    if (ctx.layers.isVisible('furniture')) drawCalls += this.drawFurniture(ctx);
    if (ctx.layers.isVisible('analysis') && ctx.analysis) {
      drawCalls += this.drawAnalysis(ctx);
    }
    if (ctx.layers.isVisible('grid')) drawCalls += this.drawGridAndRulers(ctx);
    if (ctx.layers.isVisible('interaction') && ctx.interaction) {
      drawCalls += this.drawInteraction(ctx);
    }
    return drawCalls;
  }

  /** Overlay-only pass for WebGL backend (vectors + labels + grid). */
  drawOverlay(ctx: OverlayDrawContext, clearTransparent = true): number {
    const { camera } = ctx;
    this.resize(camera);
    const c = this.ctx;
    c.setTransform(camera.dpr, 0, 0, camera.dpr, 0, 0);
    if (clearTransparent) {
      c.clearRect(0, 0, camera.width, camera.height);
    }

    let drawCalls = 0;
    if (ctx.layers.isVisible('sections') && (ctx.lod === 'sections' || ctx.lod === 'rows')) {
      // When WebGL draws seats, still show section outlines at mid/far.
      if (ctx.lod === 'sections') drawCalls += this.drawSections(ctx);
    }
    if (ctx.layers.isVisible('rows') && ctx.lod === 'rows') {
      drawCalls += this.drawRows(ctx);
    }
    if (ctx.layers.isVisible('stage')) drawCalls += this.drawStage(ctx);
    if (ctx.layers.isVisible('furniture')) drawCalls += this.drawFurniture(ctx);
    if (ctx.layers.isVisible('analysis') && ctx.analysis) {
      drawCalls += this.drawAnalysis(ctx);
    }
    if (ctx.layers.isVisible('seats') && ctx.lod === 'seats' && ctx.lodController.showLabels(camera, ctx.scene.seatRadius)) {
      drawCalls += this.drawLabels(ctx);
    }
    if (ctx.layers.isVisible('grid')) drawCalls += this.drawGridAndRulers(ctx);
    if (ctx.layers.isVisible('interaction') && ctx.interaction) {
      drawCalls += this.drawInteraction(ctx);
    }
    return drawCalls;
  }

  private drawSeats(ctx: OverlayDrawContext): number {
    const { camera, scene, visible, visibleCount, frameStart, budgetMs } = ctx;
    const c = this.ctx;
    const r = scene.seatRadius;
    for (let i = 0; i < visibleCount; i++) {
      if (i % 2048 === 0 && performance.now() - frameStart > budgetMs) break;
      const idx = visible[i];
      const sp = camera.worldToScreen({ x: scene.xs[idx], y: scene.ys[idx] });
      const scale = scene.scales[idx];
      const radius = r * scale * camera.zoom;
      c.beginPath();
      c.arc(sp.x, sp.y, Math.max(0.5, radius), 0, Math.PI * 2);
      c.fillStyle = rgbaToCss(scene.colors, idx * 4);
      c.fill();
    }
    return 1;
  }

  private drawLabels(ctx: OverlayDrawContext): number {
    const { camera, scene, visible, visibleCount, frameStart, budgetMs } = ctx;
    const c = this.ctx;
    c.font = '10px ui-sans-serif, system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = 'rgba(255,255,255,0.85)';
    const maxLabels = 400;
    const step = Math.max(1, Math.ceil(visibleCount / maxLabels));
    for (let i = 0; i < visibleCount; i += step) {
      if (performance.now() - frameStart > budgetMs) break;
      const idx = visible[i];
      const sp = camera.worldToScreen({ x: scene.xs[idx], y: scene.ys[idx] });
      c.fillText(scene.labels[idx], sp.x, sp.y);
    }
    return 1;
  }

  private drawSections(ctx: OverlayDrawContext): number {
    const { camera, scene } = ctx;
    const c = this.ctx;
    const vp = camera.visibleWorldRect();
    for (const sec of scene.sectionAggs) {
      if (sec.maxX < vp.minX || sec.minX > vp.maxX || sec.maxY < vp.minY || sec.minY > vp.maxY) {
        continue;
      }
      const tl = camera.worldToScreen({ x: sec.minX, y: sec.minY });
      const br = camera.worldToScreen({ x: sec.maxX, y: sec.maxY });
      const w = br.x - tl.x;
      const h = br.y - tl.y;
      c.fillStyle = sec.color;
      c.globalAlpha = 0.35 + sec.heat * 0.45;
      c.fillRect(tl.x, tl.y, w, h);
      c.globalAlpha = 1;
      c.strokeStyle = sec.color;
      c.lineWidth = 1.5;
      c.strokeRect(tl.x, tl.y, w, h);
      if (camera.zoom * (sec.maxX - sec.minX) > 80) {
        c.fillStyle = 'rgba(255,255,255,0.9)';
        c.font = '12px ui-sans-serif, system-ui, sans-serif';
        c.textAlign = 'center';
        c.fillText(sec.name, tl.x + w / 2, tl.y + h / 2);
      }
    }
    // Also stroke authored section shapes when present.
    for (const sec of scene.map.sections) {
      const pts = sec.shape?.points;
      if (!pts || pts.length < 2) continue;
      c.beginPath();
      const p0 = camera.worldToScreen({ x: pts[0][0], y: pts[0][1] });
      c.moveTo(p0.x, p0.y);
      for (let i = 1; i < pts.length; i++) {
        const p = camera.worldToScreen({ x: pts[i][0], y: pts[i][1] });
        c.lineTo(p.x, p.y);
      }
      c.closePath();
      c.strokeStyle = sec.color;
      c.globalAlpha = 0.7;
      c.lineWidth = 1;
      c.stroke();
      c.globalAlpha = 1;
    }
    return 1;
  }

  private drawRows(ctx: OverlayDrawContext): number {
    const { camera, scene } = ctx;
    const c = this.ctx;
    const vp = camera.visibleWorldRect();
    c.lineWidth = Math.max(1, scene.seatRadius * camera.zoom * 0.55);
    c.lineCap = 'round';
    for (const row of scene.rowAggs) {
      if (
        Math.max(row.x0, row.x1) < vp.minX ||
        Math.min(row.x0, row.x1) > vp.maxX ||
        Math.max(row.y0, row.y1) < vp.minY ||
        Math.min(row.y0, row.y1) > vp.maxY
      ) {
        continue;
      }
      const a = camera.worldToScreen({ x: row.x0, y: row.y0 });
      const b = camera.worldToScreen({ x: row.x1, y: row.y1 });
      c.strokeStyle = row.color;
      c.globalAlpha = 0.85;
      c.beginPath();
      c.moveTo(a.x, a.y);
      c.lineTo(b.x, b.y);
      c.stroke();
    }
    c.globalAlpha = 1;
    return 1;
  }

  private drawStage(ctx: OverlayDrawContext): number {
    const stage = ctx.scene.map.venue?.stage;
    if (!stage) return 0;
    const c = this.ctx;
    const p = ctx.camera.worldToScreen({ x: stage.x, y: stage.y });
    const w = stage.width * ctx.camera.zoom;
    const h = 36 * ctx.camera.zoom;
    c.save();
    c.translate(p.x + w / 2, p.y);
    if (stage.rotation) c.rotate((stage.rotation * Math.PI) / 180);
    c.fillStyle = 'rgba(226, 232, 240, 0.85)';
    c.fillRect(-w / 2, -h / 2, w, h);
    c.fillStyle = '#0f172a';
    c.font = `${Math.max(10, 12 * Math.min(ctx.camera.zoom / 1, 1.4))}px ui-sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('STAGE', 0, 0);
    c.restore();
    return 1;
  }

  private drawFurniture(ctx: OverlayDrawContext): number {
    const furniture = ctx.scene.map.venue?.furniture;
    if (!furniture?.length) return 0;
    const c = this.ctx;
    for (const f of furniture) {
      const p = ctx.camera.worldToScreen({ x: f.x, y: f.y });
      c.fillStyle = f.type === 'door' ? '#94a3b8' : f.type === 'led' ? '#38bdf8' : '#fbbf24';
      c.beginPath();
      c.arc(p.x, p.y, Math.max(3, 5 * ctx.camera.zoom), 0, Math.PI * 2);
      c.fill();
    }
    return 1;
  }

  private drawAnalysis(ctx: OverlayDrawContext): number {
    const c = this.ctx;
    for (const overlay of ctx.analysis ?? []) {
      for (const cell of overlay.cells ?? []) {
        const tl = ctx.camera.worldToScreen({ x: cell.rect.minX, y: cell.rect.minY });
        const br = ctx.camera.worldToScreen({ x: cell.rect.maxX, y: cell.rect.maxY });
        c.globalAlpha = cell.alpha ?? 0.35;
        c.fillStyle = cell.color;
        c.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
      }
      c.globalAlpha = 1;
      for (const path of overlay.paths ?? []) {
        if (path.points.length < 2) continue;
        c.beginPath();
        const p0 = ctx.camera.worldToScreen(path.points[0]);
        c.moveTo(p0.x, p0.y);
        for (let i = 1; i < path.points.length; i++) {
          const p = ctx.camera.worldToScreen(path.points[i]);
          c.lineTo(p.x, p.y);
        }
        c.strokeStyle = path.color ?? '#f97316';
        c.lineWidth = path.width ?? 2;
        c.stroke();
      }
    }
    return 1;
  }

  private drawGridAndRulers(ctx: OverlayDrawContext): number {
    const { camera, scene } = ctx;
    const scale = scene.map.venue?.scale ?? 40;
    const spec = computeGridSpec(camera, scale);
    const vp = camera.visibleWorldRect();
    const { vertical, horizontal } = collectGridLines(vp, spec);
    const c = this.ctx;

    c.save();
    for (const line of vertical) {
      const sp = camera.worldToScreen({ x: line.a, y: 0 });
      c.beginPath();
      c.moveTo(sp.x, 0);
      c.lineTo(sp.x, camera.height);
      c.strokeStyle = line.major ? 'rgba(148,163,184,0.28)' : 'rgba(148,163,184,0.12)';
      c.lineWidth = line.major ? 1 : 0.5;
      c.stroke();
    }
    for (const line of horizontal) {
      const sp = camera.worldToScreen({ x: 0, y: line.a });
      c.beginPath();
      c.moveTo(0, sp.y);
      c.lineTo(camera.width, sp.y);
      c.strokeStyle = line.major ? 'rgba(148,163,184,0.28)' : 'rgba(148,163,184,0.12)';
      c.lineWidth = line.major ? 1 : 0.5;
      c.stroke();
    }

    // Edge rulers (CSS px chrome).
    const ruler = 22;
    c.fillStyle = 'rgba(15,23,42,0.82)';
    c.fillRect(0, 0, camera.width, ruler);
    c.fillRect(0, 0, ruler, camera.height);
    c.fillStyle = 'rgba(226,232,240,0.9)';
    c.font = '10px ui-sans-serif, system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (const line of vertical) {
      if (!line.major) continue;
      const sp = camera.worldToScreen({ x: line.a, y: 0 });
      if (sp.x < ruler) continue;
      c.fillText(formatMeters(mapToMeters(line.a, scale)), sp.x, ruler / 2);
    }
    c.textAlign = 'center';
    for (const line of horizontal) {
      if (!line.major) continue;
      const sp = camera.worldToScreen({ x: 0, y: line.a });
      if (sp.y < ruler) continue;
      c.save();
      c.translate(ruler / 2, sp.y);
      c.rotate(-Math.PI / 2);
      c.fillText(formatMeters(mapToMeters(line.a, scale)), 0, 0);
      c.restore();
    }
    c.restore();
    return 1;
  }

  private drawInteraction(ctx: OverlayDrawContext): number {
    const inter = ctx.interaction;
    if (!inter) return 0;
    const c = this.ctx;
    const { camera } = ctx;
    if (inter.marquee) {
      const tl = camera.worldToScreen({ x: inter.marquee.minX, y: inter.marquee.minY });
      const br = camera.worldToScreen({ x: inter.marquee.maxX, y: inter.marquee.maxY });
      c.fillStyle = 'rgba(225, 29, 72, 0.12)';
      c.strokeStyle = 'rgba(225, 29, 72, 0.9)';
      c.lineWidth = 1;
      c.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
      c.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    }
    if (inter.lasso && inter.lasso.length > 1) {
      c.beginPath();
      const p0 = camera.worldToScreen(inter.lasso[0]);
      c.moveTo(p0.x, p0.y);
      for (let i = 1; i < inter.lasso.length; i++) {
        const p = camera.worldToScreen(inter.lasso[i]);
        c.lineTo(p.x, p.y);
      }
      c.closePath();
      c.fillStyle = 'rgba(56, 189, 248, 0.1)';
      c.strokeStyle = 'rgba(56, 189, 248, 0.9)';
      c.fill();
      c.stroke();
    }
    for (const h of inter.handles ?? []) {
      const p = camera.worldToScreen(h);
      c.fillStyle = '#fff';
      c.strokeStyle = '#e11d48';
      c.lineWidth = 1.5;
      c.beginPath();
      c.rect(p.x - 4, p.y - 4, 8, 8);
      c.fill();
      c.stroke();
    }
    return 1;
  }
}
