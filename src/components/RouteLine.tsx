import { useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo } from "react";
import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { CONFIG } from "../data/config";
import { Route } from "../data/route";
import { RiaSection, sectionRange } from "./RiaSection";
import { TunnelTube } from "./TunnelTube";

const R = CONFIG.route;
const U = R.underground;

/* Línea verde de la infraestructura.
   Modo subterráneo (CONFIG.route.underground.enabled):
   - tunnel:  el trazado enterrado, visible a través del terreno y de los edificios (radiografía)
   - glow:    halo discreto del túnel
   - trace:   traza fina discontinua sobre la superficie, justo encima del túnel
   - curtain: cortina de sección translúcida entre el túnel y la superficie, que se desvanece hacia arriba
   Mismo color y grosor en todo el recorrido (también bajo la ría). */
export const RouteLine: React.FC<{ route: Route; progress: number }> = ({ route, progress }) => {
  const size = useThree((s) => s.size);
  const scale = size.height / 1080;
  const color = useMemo(() => new THREE.Color(CONFIG.colors.route), []);

  const parts = useMemo(() => {
    const mk = (width: number, opacity: number, depthTest: boolean, order: number, dashed = false) => {
      const m = new LineMaterial({ color: color.getHex(), linewidth: width, transparent: opacity < 1 || !depthTest, opacity, depthTest, depthWrite: false, worldUnits: false, dashed });
      m.toneMapped = false;
      const l = new Line2(new LineGeometry(), m);
      l.renderOrder = order;
      l.frustumCulled = false;
      return l;
    };
    const under = U.enabled;
    const curtainMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide, toneMapped: false });
    const curtain = new THREE.Mesh(new THREE.BufferGeometry(), curtainMat);
    curtain.renderOrder = 9;
    curtain.frustumCulled = false;
    const trace = mk(2.2, U.surfaceTrace, true, 13, true);
    const tm = trace.material as LineMaterial;
    tm.dashSize = U.surfaceDash[0]; tm.gapSize = U.surfaceDash[1];
    tm.color = new THREE.Color("#E9FFF1");
    return {
      under,
      glow: mk(R.glowWidth, R.glowOpacity, !under, 10),
      core: mk(R.width, under ? U.lineOpacity : 1, true, 11),
      xray: mk(R.width * (under ? 1 : 0.8), under ? U.lineOpacity : R.xray, false, 12),
      tube: CONFIG.route.tunnel.enabled,
      trace,
      curtain,
    };
  }, [color]);

  useLayoutEffect(() => {
    const N = route.pts.length, f = progress * (N - 1), n = Math.floor(f);
    const idx: number[] = [];
    for (let i = 0; i <= n && i < N; i++) idx.push(i);
    const head = route.at(progress), headS = route.surfaceAt(progress);
    const pts = idx.map((i) => route.pts[i]), tops = idx.map((i) => route.surface[i]);
    if (f > n && n < N - 1) { pts.push(head); tops.push(headS); }
    const visible = progress > 0.0005 && pts.length >= 2;
    const flat = pts.flatMap((p) => [p.x, p.y, p.z]);

    const setLine = (l: Line2, positions: number[], width: number) => {
      l.visible = visible && positions.length >= 6;
      if (!l.visible) return;
      l.geometry.dispose();
      const g = new LineGeometry();
      g.setPositions(positions);
      l.geometry = g;
      l.computeLineDistances();
      const m = l.material as LineMaterial;
      m.resolution.set(size.width, size.height);
      m.linewidth = width * scale;
    };
    const coreW = parts.tube ? CONFIG.route.tunnel.coreWidth : R.width;
    setLine(parts.glow, flat, parts.tube ? R.glowWidth * 0.8 : R.glowWidth);
    setLine(parts.core, flat, coreW);
    setLine(parts.xray, flat, parts.tube ? coreW : R.width * (parts.under ? 1 : 0.8));

    // traza en superficie y cortina: solo donde el túnel va enterrado (no en los pozos verticales)
    const horiz = pts.map((p, i) => (i === 0 ? false : Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z) > 0.01));
    const tracePos: number[] = [];
    pts.forEach((p, i) => { if (horiz[i] || horiz[i + 1]) tracePos.push(p.x, tops[i] + 0.5, p.z); });
    if (parts.under) setLine(parts.trace, tracePos, 2.2);
    else parts.trace.visible = false;

    const c = parts.curtain;
    c.visible = parts.under && visible && pts.length >= 2;
    if (c.visible) {
      const pos: number[] = [], col: number[] = [];
      const a0 = U.curtainOpacity;
      const sec = sectionRange(route);
      for (let i = 1; i < pts.length; i++) {
        if (!horiz[i]) continue;
        const k = idx[i] ?? idx[idx.length - 1] + 1; // la punta interpolada pertenece al tramo siguiente
        if (sec && k >= sec.i0 && k <= sec.i1 + 1) continue;
        const p = pts[i - 1], q = pts[i];
        const quad: [number, number, number, number][] = [
          [p.x, p.y, p.z, a0], [q.x, q.y, q.z, a0], [q.x, tops[i], q.z, 0],
          [p.x, p.y, p.z, a0], [q.x, tops[i], q.z, 0], [p.x, tops[i - 1], p.z, 0],
        ];
        for (const [x, y, z, a] of quad) { pos.push(x, y, z); col.push(color.r, color.g, color.b, a); }
      }
      c.geometry.dispose();
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(col, 4));
      c.geometry = g;
    }
  }, [progress, route, parts, size, scale, color]);

  return (
    <>
      <RiaSection route={route} progress={progress} />
      <TunnelTube route={route} progress={progress} />
      <primitive object={parts.curtain} />
      <primitive object={parts.glow} />
      <primitive object={parts.core} />
      <primitive object={parts.xray} />
      <primitive object={parts.trace} />
    </>
  );
};
