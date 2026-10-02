import { useLayoutEffect, useMemo } from "react";
import * as THREE from "three";
import { CONFIG } from "../data/config";
import { Territory as TerritoryData, Frame, makeFrame } from "../data/route";
import type { Pose } from "./CameraRig";

const C = CONFIG.colors;

/* ---------- Textura del suelo: usos, agua, viario y sombra ambiental junto a los edificios ---------- */
function groundCanvas(T: TerritoryData, fr: Frame) {
  const { width: cw, height: ch } = CONFIG.groundTexture;
  const W = fr.xmax - fr.xmin, D = fr.zmax - fr.zmin, sx = cw / W, sz = ch / D;
  const cv = document.createElement("canvas");
  cv.width = cw; cv.height = ch;
  const g = cv.getContext("2d")!;
  const X = (dm: number) => (dm / 10 - fr.xmin) * sx, Z = (dm: number) => (dm / 10 - fr.zmin) * sz;
  const path = (flat: number[], close: boolean) => {
    for (let i = 0; i < flat.length; i += 2) (i ? g.lineTo : g.moveTo).call(g, X(flat[i]), Z(flat[i + 1]));
    if (close) g.closePath();
  };
  const px = (sx + sz) / 2;

  g.fillStyle = C.ground; g.fillRect(0, 0, cw, ch);
  for (const kind of ["open", "industrial"] as const) {
    g.fillStyle = kind === "open" ? C.groundOpen : C.groundDark;
    g.globalAlpha = kind === "open" ? 1 : 0.35;
    for (const a of T.areas) {
      if (a.k !== kind) continue;
      g.beginPath();
      a.r.forEach((r) => path(r, true));
      g.fill("evenodd");
    }
  }
  g.globalAlpha = 1;

  // agua: azul plano, con un filo algo más oscuro para separarla del terreno
  g.beginPath();
  T.water.forEach((rings) => rings.forEach((r) => path(r, true)));
  g.fillStyle = C.water; g.fill("evenodd");
  g.strokeStyle = C.waterEdge; g.lineWidth = Math.max(1, 2.2 * px); g.stroke();
  g.lineCap = "round"; g.lineJoin = "round";
  g.strokeStyle = C.water; g.lineWidth = Math.max(1, 3 * px);
  for (const s of T.streams) { g.beginPath(); path(s, false); g.stroke(); }

  // viario: borde + relleno, los mayores encima
  const roads = T.roads.slice().sort((a, b) => a.w - b.w);
  for (const pass of [0, 1]) {
    for (const r of roads) {
      g.strokeStyle = pass === 0 ? C.roadEdge : C.road;
      g.lineWidth = Math.max(1.2, (r.w + (pass === 0 ? 2.2 : 0)) * px);
      g.beginPath(); path(r.p, false); g.stroke();
    }
  }
  g.strokeStyle = C.rail; g.lineWidth = Math.max(1, 2.4 * px);
  g.setLineDash([6 * px, 4 * px]);
  for (const r of T.rail) { g.beginPath(); path(r.p, false); g.stroke(); }
  g.setLineDash([]);

  // sombra ambiental suave alrededor de los edificios
  const k = 4, ao = document.createElement("canvas");
  ao.width = cw / k; ao.height = ch / k;
  const a = ao.getContext("2d")!;
  a.fillStyle = "#fff"; a.fillRect(0, 0, ao.width, ao.height);
  a.filter = `blur(${Math.max(1, 2.2 * px)}px)`;
  a.fillStyle = "#8d959b";
  a.beginPath();
  for (const b of T.buildings) {
    for (let i = 0; i < b.o.length; i += 2) {
      const x = X(b.o[i]) / k, z = Z(b.o[i + 1]) / k;
      i ? a.lineTo(x, z) : a.moveTo(x, z);
    }
    a.closePath();
  }
  a.fill();
  g.globalCompositeOperation = "multiply";
  g.drawImage(ao, 0, 0, cw, ch);
  g.globalCompositeOperation = "source-over";
  return cv;
}

/* ---------- Bruma por distancia + desvanecimiento hacia el límite de los datos (sin peana) ---------- */
export function installFade(mat: THREE.Material, fr: Frame, fadeColor: string = C.background, fog = CONFIG.fog) {
  const U = {
    uFogRange: { value: new THREE.Vector2(fog.near, fog.far) },
    uFadeCol: { value: new THREE.Color(fadeColor) },
    uRect: { value: new THREE.Vector4(fr.xmin, fr.xmax, fr.zmin, fr.zmax) },
    uEdgeW: { value: fog.edge },
  };
  const prevCompile = mat.onBeforeCompile.bind(mat);
  mat.onBeforeCompile = (sh, renderer) => {
    prevCompile(sh, renderer);
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vWxz; varying float vFogD;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvWxz = (modelMatrix * vec4(transformed, 1.0)).xz; vFogD = length(mvPosition.xyz);");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec2 uFogRange; uniform vec3 uFadeCol; uniform vec4 uRect; uniform float uEdgeW; varying vec2 vWxz; varying float vFogD;")
      .replace("#include <dithering_fragment>", `#include <dithering_fragment>
        float dEdge = min(min(vWxz.x - uRect.x, uRect.y - vWxz.x), min(vWxz.y - uRect.z, uRect.w - vWxz.y));
        float fe = 1.0 - smoothstep(0.0, uEdgeW, dEdge);
        float ff = smoothstep(uFogRange.x, uFogRange.y, vFogD);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, sRGBTransferOETF(vec4(uFadeCol, 1.0)).rgb, max(fe, ff));`);
  };
  const prev = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => prev() + "|fade-v1";
}

function terrainGeometry(T: TerritoryData, fr: Frame) {
  const { x0, z0, step, nx, nz, h } = T.dem;
  const W = fr.xmax - fr.xmin, D = fr.zmax - fr.zmin;
  const pos = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, x = x0 + i * step, z = z0 + j * step;
    pos.set([x, h[k] / 10, z], k * 3);
    uv.set([(x - fr.xmin) / W, (z - fr.zmin) / D], k * 2);
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let q = 0;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + nx, c = a + 1, d = b + 1;
    idx.set([a, b, c, c, b, d], q); q += 6;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  return g;
}

/* ---------- Edificios: huellas reales extruidas; techos claros, fachadas algo más oscuras ---------- */
function buildingsGeometry(T: TerritoryData) {
  const pos: number[] = [], nor: number[] = [], col: number[] = [];
  const roof = new THREE.Color(C.buildingsLight), wall = new THREE.Color(C.buildingsMid);
  const tmp = new THREE.Color();
  type P3 = [number, number, number];
  /* triángulo con la orientación correcta respecto a su normal (cara frontal hacia fuera) */
  const tri = (p1: P3, p2: P3, p3: P3, n: P3, c1: THREE.Color, c2: THREE.Color, c3: THREE.Color) => {
    const ux = p2[0] - p1[0], uy = p2[1] - p1[1], uz = p2[2] - p1[2];
    const vx = p3[0] - p1[0], vy = p3[1] - p1[1], vz = p3[2] - p1[2];
    const dot = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2];
    const list: [P3, THREE.Color][] = dot >= 0 ? [[p1, c1], [p2, c2], [p3, c3]] : [[p1, c1], [p3, c3], [p2, c2]];
    for (const [p, c] of list) { pos.push(...p); nor.push(...n); col.push(c.r, c.g, c.b); }
  };
  const signedArea = (r: THREE.Vector2[]) => {
    let s = 0;
    for (let i = 0, k = r.length - 1; i < r.length; k = i++) s += r[k].x * r[i].y - r[i].x * r[k].y;
    return s / 2;
  };
  for (const b of T.buildings) {
    const ring = (flat: number[]) => { const r: THREE.Vector2[] = []; for (let i = 0; i < flat.length; i += 2) r.push(new THREE.Vector2(flat[i] / 10, flat[i + 1] / 10)); return r; };
    const outer = ring(b.o), holes = b.i.map(ring);
    if (outer.length < 3) continue;
    const y0 = b.b - 3, y1 = b.b + b.h;
    const v = 0.93 + 0.1 * b.t; // ligera variación por edificio
    const cRoof = roof.clone().multiplyScalar(v), cTop = wall.clone().multiplyScalar(v), cLow = tmp.copy(wall).multiplyScalar(v * 0.8).clone();
    [outer, ...holes].forEach((r, ri) => {
      const sg = Math.sign(signedArea(r)) * (ri === 0 ? 1 : -1);
      for (let i = 0, k = r.length - 1; i < r.length; k = i++) {
        const a = r[k], c = r[i], dx = c.x - a.x, dz = c.y - a.y, len = Math.hypot(dx, dz);
        if (len < 0.05) continue;
        const n: P3 = [(sg * dz) / len, 0, (-sg * dx) / len];
        const A0: P3 = [a.x, y0, a.y], C0: P3 = [c.x, y0, c.y], C1: P3 = [c.x, y1, c.y], A1: P3 = [a.x, y1, a.y];
        tri(A0, C0, C1, n, cLow, cLow, cTop);
        tri(A0, C1, A1, n, cLow, cTop, cTop);
      }
    });
    const all = outer.concat(...holes);
    for (const f of THREE.ShapeUtils.triangulateShape(outer, holes)) {
      const A = all[f[0]], B = all[f[1]], Cc = all[f[2]];
      tri([A.x, y1, A.y], [B.x, y1, B.y], [Cc.x, y1, Cc.y], [0, 1, 0], cRoof, cRoof, cRoof);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return g;
}

export const useTerritoryScene = (T: TerritoryData) =>
  useMemo(() => {
    const fr = makeFrame(T);
    const tex = new THREE.CanvasTexture(groundCanvas(T, fr));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false;
    tex.anisotropy = 16;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    const terrainMat = new THREE.MeshLambertMaterial({ map: tex });
    const bldMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    installFade(terrainMat, fr);
    installFade(bldMat, fr);
    const terrain = new THREE.Mesh(terrainGeometry(T, fr), terrainMat);
    terrain.receiveShadow = true;
    const buildings = new THREE.Mesh(buildingsGeometry(T), bldMat);
    buildings.castShadow = true; buildings.receiveShadow = true;
    return { fr, terrain, buildings };
  }, [T]);

/* ---------- Luz de estudio: sol suave con sombras que siguen al punto de mira ---------- */
export type LightSetup = { sun: number; sunColor: string; hemi: number; sky: string; ground: string; fill: number; dir: [number, number, number] };
const STUDIO: LightSetup = { sun: CONFIG.light.sun, sunColor: "#ffffff", hemi: CONFIG.light.hemi, sky: "#f4f7f9", ground: "#b9bcbd", fill: CONFIG.light.fill, dir: CONFIG.light.dir };

export const Lights: React.FC<{ pose: Pose; setup?: LightSetup }> = ({ pose, setup = STUDIO }) => {
  const sun = useMemo(() => {
    const l = new THREE.DirectionalLight(setup.sunColor, setup.sun);
    l.castShadow = true;
    l.shadow.mapSize.set(CONFIG.light.shadowMap, CONFIG.light.shadowMap);
    l.shadow.bias = -0.0004;
    l.shadow.normalBias = 1.2;
    l.shadow.camera.near = 100;
    l.shadow.camera.far = 14000;
    return l;
  }, [setup]);
  useLayoutEffect(() => {
    const dir = new THREE.Vector3(...setup.dir).normalize();
    const ext = THREE.MathUtils.clamp(pose.range * 1.5, 700, 4200);
    const c = sun.shadow.camera;
    Object.assign(c, { left: -ext, right: ext, top: ext, bottom: -ext });
    c.updateProjectionMatrix();
    sun.target.position.copy(pose.target);
    sun.position.copy(pose.target).addScaledVector(dir, 6000);
    sun.target.updateMatrixWorld();
  }, [pose, sun, setup]);
  const d = setup.dir;
  return (
    <>
      <primitive object={sun} />
      <primitive object={sun.target} />
      <hemisphereLight args={[setup.sky, setup.ground, setup.hemi]} />
      <directionalLight color="#dfe8ff" intensity={setup.fill} position={[-d[0], d[1] * 0.5, -d[2]]} />
    </>
  );
};

export const Territory: React.FC<{ data: TerritoryData; pose: Pose }> = ({ data, pose }) => {
  const s = useTerritoryScene(data);
  return (
    <>
      <color attach="background" args={[C.background]} />
      <Lights pose={pose} />
      <primitive object={s.terrain} />
      <primitive object={s.buildings} />
    </>
  );
};
