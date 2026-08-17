import type { Camera } from './camera';
import type { SceneBuffers } from './scene-buffers';

const VERT_SRC = `#version 300 es
precision highp float;

// Unit quad corners (-1..1)
in vec2 a_corner;
in vec2 a_position;
in vec4 a_color;
in float a_scale;

uniform vec2 u_resolution; // device pixels
uniform vec2 u_camera;     // world center
uniform float u_zoom;      // css px per world unit
uniform float u_dpr;
uniform float u_radius;    // world radius

out vec4 v_color;
out vec2 v_uv;

void main() {
  float r = u_radius * a_scale;
  vec2 world = a_position + a_corner * r;
  // world → css → device
  vec2 css = (world - u_camera) * u_zoom + (u_resolution / u_dpr) * 0.5;
  vec2 clip = (css * u_dpr / u_resolution) * 2.0 - 1.0;
  // Y flip: world Y grows down (map/SVG convention), clip Y grows up.
  clip.y *= -1.0;
  gl_Position = vec4(clip, 0.0, 1.0);
  v_color = a_color;
  v_uv = a_corner;
}
`;

const FRAG_SRC = `#version 300 es
precision mediump float;
in vec4 v_color;
in vec2 v_uv;
out vec4 outColor;
void main() {
  float d = length(v_uv);
  // Smooth circle AA in quad space.
  float alpha = 1.0 - smoothstep(0.92, 1.0, d);
  if (alpha <= 0.01) discard;
  outColor = vec4(v_color.rgb, v_color.a * alpha);
}
`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('createShader failed');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(sh) ?? 'compile error';
    gl.deleteShader(sh);
    throw new Error(info);
  }
  return sh;
}

function link(gl: WebGL2RenderingContext, vert: WebGLShader, frag: WebGLShader): WebGLProgram {
  const prog = gl.createProgram();
  if (!prog) throw new Error('createProgram failed');
  gl.attachShader(prog, vert);
  gl.attachShader(prog, frag);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(prog) ?? 'link error';
    gl.deleteProgram(prog);
    throw new Error(info);
  }
  return prog;
}

/**
 * Single draw-call instanced seat renderer (WebGL2).
 *
 * Instance attributes are uploaded as three buffers (pos / color / scale)
 * so color-mode changes don't rewrite positions.
 */
export class WebGlSeatRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private cornerBuf: WebGLBuffer;
  private posBuf: WebGLBuffer;
  private colorBuf: WebGLBuffer;
  private scaleBuf: WebGLBuffer;
  private indexBuf: WebGLBuffer;
  private uResolution: WebGLUniformLocation;
  private uCamera: WebGLUniformLocation;
  private uZoom: WebGLUniformLocation;
  private uDpr: WebGLUniformLocation;
  private uRadius: WebGLUniformLocation;

  /** Compact list of visible instance indices for indirect-ish draw via CPU gather. */
  private gatherPos = new Float32Array(0);
  private gatherColor = new Float32Array(0);
  private gatherScale = new Float32Array(0);

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    const vert = compile(gl, gl.VERTEX_SHADER, VERT_SRC);
    const frag = compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
    this.program = link(gl, vert, frag);
    gl.deleteShader(vert);
    gl.deleteShader(frag);

    const vao = gl.createVertexArray();
    const cornerBuf = gl.createBuffer();
    const posBuf = gl.createBuffer();
    const colorBuf = gl.createBuffer();
    const scaleBuf = gl.createBuffer();
    const indexBuf = gl.createBuffer();
    if (!vao || !cornerBuf || !posBuf || !colorBuf || !scaleBuf || !indexBuf) {
      throw new Error('WebGL buffer allocation failed');
    }
    this.vao = vao;
    this.cornerBuf = cornerBuf;
    this.posBuf = posBuf;
    this.colorBuf = colorBuf;
    this.scaleBuf = scaleBuf;
    this.indexBuf = indexBuf;

    gl.bindVertexArray(vao);

    // Unit quad as two triangles.
    const corners = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
    gl.bufferData(gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);
    const aCorner = gl.getAttribLocation(this.program, 'a_corner');
    gl.enableVertexAttribArray(aCorner);
    gl.vertexAttribPointer(aCorner, 2, gl.FLOAT, false, 0, 0);

    const aPos = gl.getAttribLocation(this.program, 'a_position');
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, 0, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(aPos, 1);

    const aColor = gl.getAttribLocation(this.program, 'a_color');
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuf);
    gl.bufferData(gl.ARRAY_BUFFER, 0, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(aColor);
    gl.vertexAttribPointer(aColor, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(aColor, 1);

    const aScale = gl.getAttribLocation(this.program, 'a_scale');
    gl.bindBuffer(gl.ARRAY_BUFFER, scaleBuf);
    gl.bufferData(gl.ARRAY_BUFFER, 0, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(aScale);
    gl.vertexAttribPointer(aScale, 1, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(aScale, 1);

    gl.bindVertexArray(null);

    const ur = gl.getUniformLocation(this.program, 'u_resolution');
    const uc = gl.getUniformLocation(this.program, 'u_camera');
    const uz = gl.getUniformLocation(this.program, 'u_zoom');
    const ud = gl.getUniformLocation(this.program, 'u_dpr');
    const uR = gl.getUniformLocation(this.program, 'u_radius');
    if (!ur || !uc || !uz || !ud || !uR) throw new Error('missing uniforms');
    this.uResolution = ur;
    this.uCamera = uc;
    this.uZoom = uz;
    this.uDpr = ud;
    this.uRadius = uR;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  /** Upload full scene instance buffers (call on setScene / color rebake). */
  uploadScene(scene: SceneBuffers): void {
    const gl = this.gl;
    const positions = new Float32Array(scene.seatCount * 2);
    for (let i = 0; i < scene.seatCount; i++) {
      positions[i * 2] = scene.xs[i];
      positions[i * 2 + 1] = scene.ys[i];
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuf);
    gl.bufferData(gl.ARRAY_BUFFER, scene.colors, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.scaleBuf);
    gl.bufferData(gl.ARRAY_BUFFER, scene.scales, gl.DYNAMIC_DRAW);
  }

  /**
   * Draw only culled instances.
   *
   * For ≤64k visible seats we gather into contiguous buffers (one draw call).
   * Gathering beats binding a huge unused instance buffer when zoomed in on a
   * small region of a 250k map.
   */
  drawCulled(
    scene: SceneBuffers,
    camera: Camera,
    visible: Uint32Array,
    visibleCount: number,
    clearCss: string,
  ): void {
    const gl = this.gl;
    const buf = camera.bufferSize();
    gl.viewport(0, 0, buf.width, buf.height);
    const bg = parseClear(clearCss);
    gl.clearColor(bg[0], bg[1], bg[2], bg[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (visibleCount <= 0 || scene.seatCount === 0) return;

    // Ensure gather buffers are large enough.
    if (this.gatherPos.length < visibleCount * 2) {
      this.gatherPos = new Float32Array(visibleCount * 2);
      this.gatherColor = new Float32Array(visibleCount * 4);
      this.gatherScale = new Float32Array(visibleCount);
    }

    for (let i = 0; i < visibleCount; i++) {
      const idx = visible[i];
      this.gatherPos[i * 2] = scene.xs[idx];
      this.gatherPos[i * 2 + 1] = scene.ys[idx];
      const o = idx * 4;
      const g = i * 4;
      this.gatherColor[g] = scene.colors[o];
      this.gatherColor[g + 1] = scene.colors[o + 1];
      this.gatherColor[g + 2] = scene.colors[o + 2];
      this.gatherColor[g + 3] = scene.colors[o + 3];
      this.gatherScale[i] = scene.scales[idx];
    }

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.gatherPos.subarray(0, visibleCount * 2), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.gatherColor.subarray(0, visibleCount * 4), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.scaleBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.gatherScale.subarray(0, visibleCount), gl.DYNAMIC_DRAW);

    gl.uniform2f(this.uResolution, buf.width, buf.height);
    gl.uniform2f(this.uCamera, camera.x, camera.y);
    gl.uniform1f(this.uZoom, camera.zoom);
    gl.uniform1f(this.uDpr, camera.dpr);
    gl.uniform1f(this.uRadius, scene.seatRadius);

    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, visibleCount);
    gl.bindVertexArray(null);
  }

  destroy(): void {
    const gl = this.gl;
    gl.deleteBuffer(this.cornerBuf);
    gl.deleteBuffer(this.posBuf);
    gl.deleteBuffer(this.colorBuf);
    gl.deleteBuffer(this.scaleBuf);
    gl.deleteBuffer(this.indexBuf);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
    this.gatherPos = new Float32Array(0);
    this.gatherColor = new Float32Array(0);
    this.gatherScale = new Float32Array(0);
  }
}

function parseClear(css: string): [number, number, number, number] {
  const s = css.trim();
  if (s.startsWith('#')) {
    const h = s.slice(1);
    if (h.length === 3) {
      return [
        parseInt(h[0] + h[0], 16) / 255,
        parseInt(h[1] + h[1], 16) / 255,
        parseInt(h[2] + h[2], 16) / 255,
        1,
      ];
    }
    return [
      parseInt(h.slice(0, 2), 16) / 255,
      parseInt(h.slice(2, 4), 16) / 255,
      parseInt(h.slice(4, 6), 16) / 255,
      1,
    ];
  }
  return [0.07, 0.07, 0.09, 1];
}

export function tryCreateWebGL2(canvas: HTMLCanvasElement): WebGL2RenderingContext | null {
  try {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });
    return gl;
  } catch {
    return null;
  }
}
