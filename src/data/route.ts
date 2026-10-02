import { CONFIG } from "./config";

/* ---------- Tipos del territorio (public/territory.json, generado por scripts/build_territory.py) ---------- */
export type Territory = {
  meta: {
    lat0: number; lon0: number; kx: number; ky: number; fe: number; fn: number; L: number;
    rect: [number, number, number, number];
    source: string;
  };
  dem: { x0: number; z0: number; step: number; nx: number; nz: number; h: number[] };
  water: number[][][];
  streams: number[][];
  areas: { k: "open" | "industrial"; r: number[][] }[];
  roads: { p: number[]; w: number }[];
  rail: { p: number[] }[];
  buildings: { o: number[]; i: number[][]; b: number; h: number; t: number }[];
};

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
export const smooth01 = (x: number) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};

/* ---------- Proyección: marco local x = a lo largo del trazado, z = a la derecha, y = arriba ---------- */
export const makeFrame = (T: Territory) => {
  const { lat0, lon0, kx, ky, fe, fn, L } = T.meta;
  const toLocal = (lat: number, lon: number) => {
    const e = (lon - lon0) * kx, n = (lat - lat0) * ky;
    return { x: e * fe + n * fn, z: e * fn - n * fe };
  };
  const [xmin, xmax, zmin, zmax] = T.meta.rect;
  return { L, toLocal, xmin, xmax, zmin, zmax };
};
export type Frame = ReturnType<typeof makeFrame>;

/* ---------- Relieve: interpolación bilineal de la rejilla ---------- */
export const makeHeight = (T: Territory) => {
  const { x0, z0, step, nx, nz, h } = T.dem;
  return (x: number, z: number) => {
    const fx = clamp((x - x0) / step, 0, nx - 1.001), fz = clamp((z - z0) / step, 0, nz - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const at = (a: number, b: number) => h[b * nx + a] / 10;
    return lerp(lerp(at(i, j), at(i + 1, j), u), lerp(at(i, j + 1), at(i + 1, j + 1), u), v);
  };
};

/* ---------- Eje del trazado (de Artaza a Ballonti) ---------- */
export const makeRoute = (T: Territory, N = 1200) => {
  const fr = makeFrame(T);
  const hAt = makeHeight(T);
  const a = fr.toLocal(CONFIG.artaza.lat, CONFIG.artaza.lon);
  const b = fr.toLocal(CONFIG.ballonti.lat, CONFIG.ballonti.lon);
  const pts: { x: number; y: number; z: number }[] = [];
  const ground: number[] = [];
  for (let i = 0; i < N; i++) {
    const s = i / (N - 1);
    const bow = CONFIG.route.bend * fr.L * 4 * s * (1 - s);
    const x = lerp(a.x, b.x, s), z = lerp(a.z, b.z, s) + bow;
    pts.push({ x, y: 0, z });
    ground.push(Math.max(hAt(x, z), 0));
  }
  // perfil alisado: la línea no copia cada bache del terreno
  const r = Math.max(1, Math.round((60 / fr.L) * N));
  let g = ground.slice();
  for (let pass = 0; pass < 3; pass++) {
    g = g.map((_, i) => {
      let s = 0, n = 0;
      for (let j = i - r; j <= i + r; j++) if (j >= 0 && j < g.length) { s += g[j]; n++; }
      return s / n;
    });
  }
  pts.forEach((p, i) => (p.y = Math.max(g[i], ground[i]) + CONFIG.route.lift));
  // extremos exactos (centro de la rotonda / centro comercial)
  pts[0].x = a.x; pts[0].z = a.z;
  pts[N - 1].x = b.x; pts[N - 1].z = b.z;
  const at = (s: number) => {
    const f = clamp(s, 0, 1) * (N - 1), i = Math.min(N - 2, Math.floor(f)), u = f - i;
    const p = pts[i], q = pts[i + 1];
    return { x: lerp(p.x, q.x, u), y: lerp(p.y, q.y, u), z: lerp(p.z, q.z, u) };
  };
  return { pts, at, start: pts[0], end: pts[N - 1], hAt, frame: fr };
};
export type Route = ReturnType<typeof makeRoute>;
