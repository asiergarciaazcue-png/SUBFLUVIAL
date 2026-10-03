import { useLayoutEffect, useMemo } from "react";
import * as THREE from "three";
import { CONFIG } from "../data/config";
import { Route, clamp, smooth01 } from "../data/route";

const S = CONFIG.route.section;

/* Corte de sección vertical a lo largo del eje bajo la ría: lámina de agua, lecho, fangos y roca,
   con el túnel atravesándolo. Se dibuja sin prueba de profundidad: es una «ventana» abierta en el terreno. */
const vert = /* glsl */ `
  attribute vec2 aUV; // x: metros a lo largo del corte, y: cota (m)
  varying vec2 vUV;
  void main() { vUV = aUV; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const frag = /* glsl */ `
  uniform float uReveal, uOpacity, uLen, uWaterDepth, uSediment, uBottom, uTop;
  uniform vec3 cWaterTop, cWaterBottom, cBed, cSed, cRock, cRockLine, cEdge;
  varying vec2 vUV;
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  float noise(float x) { float i = floor(x), f = fract(x); return mix(hash(i), hash(i + 1.0), f * f * (3.0 - 2.0 * f)); }
  void main() {
    float y = vUV.y, x = vUV.x;
    // apertura: el corte se despliega de arriba abajo
    float depthSpan = uTop - uBottom;
    float revealY = uTop - uReveal * depthSpan;
    if (y < revealY) discard;
    float bed = -uWaterDepth + 1.6 * (noise(x / 23.0) - 0.5) + 0.8 * (noise(x / 7.0) - 0.5);
    float sedBase = bed - uSediment + 2.5 * (noise(x / 41.0 + 3.0) - 0.5);
    vec3 col;
    if (y > 0.0) col = cEdge;
    else if (y > bed) col = mix(cWaterBottom, cWaterTop, clamp(1.0 + y / uWaterDepth, 0.0, 1.0));
    else if (y > sedBase) col = mix(cSed, cBed, smoothstep(sedBase, bed, y)) * (0.92 + 0.08 * noise(x / 3.0 + y));
    else {
      col = cRock;
      float strata = abs(fract((y + 3.0 * noise(x / 60.0)) / 6.5) - 0.5);
      col = mix(cRockLine, col, smoothstep(0.0, 0.06, strata));
    }
    // filo luminoso en la superficie del agua y línea del lecho
    col = mix(col, cEdge, (1.0 - smoothstep(0.0, 0.6, abs(y))) * 0.9);
    col = mix(col, cBed * 1.15, (1.0 - smoothstep(0.0, 0.35, abs(y - bed))) * 0.8);
    // bordes suaves en los extremos y en el fondo (el corte «se funde» en el terreno)
    float edgeX = smoothstep(0.0, 35.0, x) * smoothstep(0.0, 35.0, uLen - x);
    float edgeB = smoothstep(uBottom, uBottom + 14.0, y);
    float a = uOpacity * edgeX * edgeB;
    // frente de apertura brillante
    a = max(a, (1.0 - smoothstep(0.0, 1.5, y - revealY)) * edgeX * 0.9 * step(uReveal, 0.999));
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }
`;

/* Tramo del trazado (índices) que ocupa el corte de sección */
export const sectionRange = (route: Route) => {
  const cr = route.crossing[0];
  if (!S.enabled || !cr) return null;
  const N = route.pts.length, m = S.margin / route.frame.L;
  const a = clamp(Math.min(cr.a, cr.b) - m, 0, 1), b = clamp(Math.max(cr.a, cr.b) + m, 0, 1);
  return { a, b, i0: Math.floor(a * (N - 1)), i1: Math.ceil(b * (N - 1)) };
};

export const RiaSection: React.FC<{ route: Route; progress: number }> = ({ route, progress }) => {
  const mesh = useMemo(() => {
    const C = S.colors;
    const m = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      uniforms: {
        uReveal: { value: 0 }, uOpacity: { value: S.opacity }, uLen: { value: 1 }, uWaterDepth: { value: S.waterDepth },
        uSediment: { value: S.sediment }, uBottom: { value: -60 }, uTop: { value: 1 },
        cWaterTop: { value: new THREE.Color(C.waterTop) }, cWaterBottom: { value: new THREE.Color(C.waterBottom) },
        cBed: { value: new THREE.Color(C.bed) }, cSed: { value: new THREE.Color(C.sediment) }, cRock: { value: new THREE.Color(C.rock) },
        cRockLine: { value: new THREE.Color(C.rockLine) }, cEdge: { value: new THREE.Color(C.edge) },
      },
    });
    const o = new THREE.Mesh(new THREE.BufferGeometry(), m);
    o.renderOrder = 8;
    o.frustumCulled = false;
    return o;
  }, []);

  // geometría fija del corte (no depende del fotograma)
  const geo = useMemo(() => {
    const r = sectionRange(route);
    if (!r) return null;
    const { a, i0, i1 } = r;
    let minY = Infinity;
    for (let i = i0; i <= i1; i++) minY = Math.min(minY, route.pts[i].y);
    const bottom = minY - CONFIG.route.tunnel.diameter / 2 - S.below;
    const pos: number[] = [], uv: number[] = [];
    let dist = 0;
    for (let i = i0; i < i1; i++) {
      const p = route.pts[i], q = route.pts[i + 1];
      const seg = Math.hypot(q.x - p.x, q.z - p.z);
      const top = 1;
      const quad: [number, number, number, number, number][] = [
        [p.x, bottom, p.z, dist, bottom], [q.x, bottom, q.z, dist + seg, bottom], [q.x, top, q.z, dist + seg, top],
        [p.x, bottom, p.z, dist, bottom], [q.x, top, q.z, dist + seg, top], [p.x, top, p.z, dist, top],
      ];
      for (const [x, y, z, u, v] of quad) { pos.push(x, y, z); uv.push(u, v); }
      dist += seg;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aUV", new THREE.Float32BufferAttribute(uv, 2));
    return { g, a, len: dist, bottom };
  }, [route]);

  useLayoutEffect(() => {
    if (!geo) { mesh.visible = false; return; }
    if (mesh.geometry !== geo.g) mesh.geometry = geo.g;
    const u = (mesh.material as THREE.ShaderMaterial).uniforms;
    const start = geo.a - S.openAhead;
    const reveal = smooth01((progress - start) / S.openDuration);
    u.uReveal.value = reveal;
    u.uLen.value = geo.len;
    u.uBottom.value = geo.bottom;
    mesh.visible = reveal > 0.001;
  }, [geo, mesh, progress]);

  return <primitive object={mesh} />;
};
