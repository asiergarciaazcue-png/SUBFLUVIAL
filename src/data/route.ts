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
  const U = CONFIG.route.underground;
  // túnel: todo el trazado a `depth` m bajo el terreno (perfil alisado), con rampas de entrada y salida
  // de pendiente máxima `rampAngle` (perfil suavizado: pendiente máx. = 1,5 × media → longitud = 1,5·depth/tan θ)
  const rampLen = (1.5 * U.depth) / Math.tan((U.rampAngle * Math.PI) / 180);
  pts.forEach((p, i) => {
    const surf = Math.max(g[i], ground[i]);
    if (!U.enabled) { p.y = surf + CONFIG.route.lift; return; }
    const dA = (i / (N - 1)) * fr.L, dB = fr.L - dA;
    const k = smooth01(dA / rampLen) * smooth01(dB / rampLen);
    p.y = surf + 1.5 - (U.depth + 1.5) * k;
  });

  // paso subfluvial: tramos de agua (cota ~0) suficientemente largos → la línea baja bajo la ría
  const ds = fr.L / (N - 1), { depth, ramp, minWater } = CONFIG.route.dip;
  const wet = ground.map((h) => h < 0.4);
  const water = new Array(N).fill(false);
  for (let i = 0; i < N; ) {
    if (!wet[i]) { i++; continue; }
    let j = i;
    while (j + 1 < N && wet[j + 1]) j++;
    if ((j - i + 1) * ds >= minWater) for (let k = i; k <= j; k++) water[k] = true;
    i = j + 1;
  }
  const crossing: { a: number; b: number }[] = [];
  for (let i = 0; i < N; i++) if (water[i] && (i === 0 || !water[i - 1])) {
    let j = i; while (j + 1 < N && water[j + 1]) j++;
    crossing.push({ a: i / (N - 1), b: j / (N - 1) });
  }
  const win = Math.ceil(ramp / ds);
  const dip = pts.map((_, i) => {
    let w = 0;
    for (let j = Math.max(0, i - win); j <= Math.min(N - 1, i + win); j++) {
      if (water[j]) w = Math.max(w, smooth01(1 - (Math.abs(i - j) * ds) / ramp));
    }
    return w;
  });
  pts.forEach((p, i) => (p.y -= depth * dip[i]));
  // extremos exactos (centro de la rotonda de Artaza / rotonda de Ballonti)
  pts[0].x = a.x; pts[0].z = a.z;
  pts[N - 1].x = b.x; pts[N - 1].z = b.z;
  // superficie sobre cada punto (suelo o lámina de agua): techo de la cortina de sección y traza en superficie
  let surface = pts.map((p) => Math.max(hAt(p.x, p.z), 0) + 1.5);

  // pozos verticales: la línea baja desde la rotonda de Artaza y sube en la de Ballonti
  if (U.enabled && U.shaftPoints > 0) {
    const k = U.shaftPoints;
    const topA = Math.max(hAt(a.x, a.z), 0) + 1.5, topB = Math.max(hAt(b.x, b.z), 0) + 1.5;
    const down = Array.from({ length: k }, (_, i) => ({ x: a.x, z: a.z, y: lerp(topA, pts[0].y, i / k) }));
    const up = Array.from({ length: k }, (_, i) => ({ x: b.x, z: b.z, y: lerp(pts[N - 1].y, topB, (i + 1) / k) }));
    pts.unshift(...down);
    pts.push(...up);
    surface = [...down.map(() => topA), ...surface, ...up.map(() => topB)];
  }
  const M = pts.length;
  const at = (s: number) => {
    const f = clamp(s, 0, 1) * (M - 1), i = Math.min(M - 2, Math.floor(f)), u = f - i;
    const p = pts[i], q = pts[i + 1];
    return { x: lerp(p.x, q.x, u), y: lerp(p.y, q.y, u), z: lerp(p.z, q.z, u) };
  };
  const surfaceAt = (s: number) => {
    const f = clamp(s, 0, 1) * (M - 1), i = Math.min(M - 2, Math.floor(f));
    return lerp(surface[i], surface[i + 1], f - i);
  };
  return { pts, surface, at, surfaceAt, start: pts[0], end: pts[M - 1], hAt, frame: fr, crossing };
};
export type Route = ReturnType<typeof makeRoute>;
