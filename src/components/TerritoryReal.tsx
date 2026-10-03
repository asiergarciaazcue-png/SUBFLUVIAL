import { useMemo } from "react";
import * as THREE from "three";
import { CONFIG } from "../data/config";
import { Frame, makeFrame, makeHeight, Territory as TerritoryData } from "../data/route";
import type { Pose } from "./CameraRig";
import { installFade, Lights } from "./Territory";
import { patchMaterial, setXray } from "./xray";

const R = CONFIG.real;

export type OrthoTile = { file: string; x0: number; x1: number; z0: number; z1: number; w: number; h: number; texture?: THREE.Texture };
export type Ortho = { source: string; credit: string; res: number; tiles: OrthoTile[] };

/* Relieve de una tesela: rejilla propia con uv 0–1 sobre su ortofoto */
function tileTerrain(T: TerritoryData, t: OrthoTile) {
  const hAt = makeHeight(T);
  const step = T.dem.step;
  const nx = Math.max(2, Math.ceil((t.x1 - t.x0) / step) + 1), nz = Math.max(2, Math.ceil((t.z1 - t.z0) / step) + 1);
  const pos = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const u = i / (nx - 1), v = j / (nz - 1), x = t.x0 + u * (t.x1 - t.x0), z = t.z0 + v * (t.z1 - t.z0), k = j * nx + i;
    pos.set([x, hAt(x, z), z], k * 3);
    uv.set([u, v], k * 2);
  }
  const idx: number[] = [];
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + nx, c = a + 1, d = b + 1;
    idx.push(a, b, c, c, b, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* Edificios de una tesela: tejados con la ortofoto (proyección cenital) y fachadas con el color del tejado
   mezclado con un tono de fachada y un patrón suave de plantas/ventanas. */
function tileBuildings(list: TerritoryData["buildings"], t: OrthoTile) {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [], wall: number[] = [];
  const U = (x: number) => (x - t.x0) / (t.x1 - t.x0), V = (z: number) => (z - t.z0) / (t.z1 - t.z0);
  type P3 = [number, number, number];
  const tri = (p: P3[], n: P3, uvs: [number, number][], c: number[], w: [number, number][]) => {
    const [p1, p2, p3] = p;
    const ux = p2[0] - p1[0], uy = p2[1] - p1[1], uz = p2[2] - p1[2], vx = p3[0] - p1[0], vy = p3[1] - p1[1], vz = p3[2] - p1[2];
    const dot = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2];
    const order = dot >= 0 ? [0, 1, 2] : [0, 2, 1];
    for (const i of order) { pos.push(...p[i]); nor.push(...n); uv.push(...uvs[i]); col.push(c[0], c[1], c[2]); wall.push(...w[i]); }
  };
  const area = (r: THREE.Vector2[]) => { let s = 0; for (let i = 0, k = r.length - 1; i < r.length; k = i++) s += r[k].x * r[i].y - r[i].x * r[k].y; return s / 2; };
  for (const b of list) {
    const ring = (f: number[]) => { const r: THREE.Vector2[] = []; for (let i = 0; i < f.length; i += 2) r.push(new THREE.Vector2(f[i] / 10, f[i + 1] / 10)); return r; };
    const outer = ring(b.o), holes = b.i.map(ring);
    if (outer.length < 3) continue;
    const y0 = b.b - 3, y1 = b.b + b.h;
    const tone = 0.9 + 0.2 * b.t;
    const c = [tone, tone, tone];
    [outer, ...holes].forEach((r, ri) => {
      const sg = Math.sign(area(r)) * (ri === 0 ? 1 : -1);
      let run = 0;
      for (let i = 0, k = r.length - 1; i < r.length; k = i++) {
        const a = r[k], d = r[i], dx = d.x - a.x, dz = d.y - a.y, len = Math.hypot(dx, dz);
        if (len < 0.05) continue;
        const n: P3 = [(sg * dz) / len, 0, (-sg * dx) / len];
        // uv de fachada: color del borde del tejado (constante en vertical)
        const ua: [number, number] = [U(a.x), V(a.y)], ud: [number, number] = [U(d.x), V(d.y)];
        const wa0: [number, number] = [run, y0 - b.b], wd0: [number, number] = [run + len, y0 - b.b];
        const wa1: [number, number] = [run, b.h], wd1: [number, number] = [run + len, b.h];
        tri([[a.x, y0, a.y], [d.x, y0, d.y], [d.x, y1, d.y]], n, [ua, ud, ud], c, [wa0, wd0, wd1]);
        tri([[a.x, y0, a.y], [d.x, y1, d.y], [a.x, y1, a.y]], n, [ua, ud, ua], c, [wa0, wd1, wa1]);
        run += len;
      }
    });
    const all = outer.concat(...holes);
    for (const f of THREE.ShapeUtils.triangulateShape(outer, holes)) {
      const ps = f.map((i) => all[i]);
      tri(ps.map((p) => [p.x, y1, p.y] as P3), [0, 1, 0], ps.map((p) => [U(p.x), V(p.y)] as [number, number]), c, [[-1, -1], [-1, -1], [-1, -1]]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute("aWall", new THREE.Float32BufferAttribute(wall, 2)); // (metros a lo largo de la fachada, altura) o (-1,-1) en tejados
  return g;
}

function facadeMaterial(map: THREE.Texture, fr: Frame) {
  const m = new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.9, metalness: 0 });
  const facade = new THREE.Color(R.facade);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uFacade = { value: facade };
    sh.uniforms.uFacadeMix = { value: R.facadeMix };
    sh.uniforms.uWin = { value: R.windows };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 aWall; varying vec2 vWall;")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\nvWall = aWall;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vWall; uniform vec3 uFacade; uniform float uFacadeMix; uniform float uWin;")
      .replace("#include <map_fragment>", `#include <map_fragment>
        if (vWall.y >= 0.0) {
          vec3 base = mix(diffuseColor.rgb, uFacade, uFacadeMix);
          // plantas (~3,1 m) y huecos (~3,4 m): rectángulos oscuros suaves
          float fy = fract(vWall.y / 3.1), fx = fract(vWall.x / 3.4);
          float win = smoothstep(0.30, 0.36, fy) * (1.0 - smoothstep(0.78, 0.84, fy)) * smoothstep(0.22, 0.28, fx) * (1.0 - smoothstep(0.72, 0.78, fx));
          win *= step(2.5, vWall.y);
          // oscurecimiento hacia la base (ambiente)
          base *= mix(0.78, 1.0, smoothstep(0.0, 9.0, vWall.y));
          diffuseColor.rgb = base * (1.0 - uWin * win);
        }`);
  };
  m.customProgramCacheKey = () => "facade-v1";
  installFade(m, fr, R.haze, R.fog);
  return m;
}

export const useRealScene = (T: TerritoryData, ortho: Ortho) =>
  useMemo(() => {
    const fr = makeFrame(T);
    const group = new THREE.Group();
    // reparte cada edificio en la tesela que contiene su centroide
    const buckets = ortho.tiles.map(() => [] as TerritoryData["buildings"]);
    for (const b of T.buildings) {
      let cx = 0, cz = 0;
      for (let i = 0; i < b.o.length; i += 2) { cx += b.o[i]; cz += b.o[i + 1]; }
      cx /= (b.o.length / 2) * 10; cz /= (b.o.length / 2) * 10;
      const k = ortho.tiles.findIndex((t) => cx >= t.x0 && cx < t.x1 && cz >= t.z0 && cz < t.z1);
      if (k >= 0) buckets[k].push(b);
    }
    ortho.tiles.forEach((t, k) => {
      const map = t.texture!;
      const tm = new THREE.MeshStandardMaterial({ map, roughness: 1, metalness: 0 });
      installFade(tm, fr, R.haze, R.fog);
      patchMaterial(tm);
      const terrain = new THREE.Mesh(tileTerrain(T, t), tm);
      terrain.receiveShadow = true;
      const fm = facadeMaterial(map, fr);
      patchMaterial(fm);
      const bm = new THREE.Mesh(tileBuildings(buckets[k], t), fm);
      bm.castShadow = true; bm.receiveShadow = true;
      group.add(terrain, bm);
    });
    // suelo lejano: continúa el territorio con el color de la bruma hasta el horizonte (sin borde ni peana)
    const far = new THREE.Mesh(new THREE.PlaneGeometry(200000, 200000).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: R.haze }));
    far.position.y = -6;
    group.add(far);
    return group;
  }, [T, ortho]);

export const TerritoryReal: React.FC<{ data: TerritoryData; ortho: Ortho; pose: Pose; xray?: number }> = ({ data, ortho, pose, xray = 0 }) => {
  const group = useRealScene(data, ortho);
  setXray(xray);
  return (
    <>
      <Lights pose={pose} setup={R.light} />
      <primitive object={group} />
    </>
  );
};
