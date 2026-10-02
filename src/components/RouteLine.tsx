import { useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo } from "react";
import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { CONFIG } from "../data/config";
import { Route } from "../data/route";

const R = CONFIG.route;

/* Línea verde: un único trazo continuo de grosor estable en pantalla.
   - core:  trazo nítido, oculto por los edificios que tiene delante
   - xray:  el mismo trazo, atenuado, visible a través de los volúmenes (lectura de infraestructura subterránea)
   - glow:  halo discreto
   Mismo color, grosor y material de principio a fin (también bajo la ría). */
export const RouteLine: React.FC<{ route: Route; progress: number }> = ({ route, progress }) => {
  const size = useThree((s) => s.size);
  const scale = size.height / 1080;
  const lines = useMemo(() => {
    const color = new THREE.Color(CONFIG.colors.route);
    const mk = (width: number, opacity: number, depthTest: boolean, order: number) => {
      const m = new LineMaterial({ color: color.getHex(), linewidth: width, transparent: opacity < 1, opacity, depthTest, depthWrite: false, worldUnits: false });
      m.toneMapped = false;
      const l = new Line2(new LineGeometry(), m);
      l.renderOrder = order;
      l.frustumCulled = false;
      return l;
    };
    return { glow: mk(R.glowWidth, R.glowOpacity, true, 10), core: mk(R.width, 1, true, 11), xray: mk(R.width * 0.8, R.xray, false, 12) };
  }, []);

  useLayoutEffect(() => {
    // puntos del tramo ya dibujado, con la punta interpolada exactamente
    const N = route.pts.length, f = progress * (N - 1), n = Math.floor(f);
    const pos: number[] = [];
    for (let i = 0; i <= n && i < N; i++) pos.push(route.pts[i].x, route.pts[i].y, route.pts[i].z);
    if (f > n && n < N - 1) { const h = route.at(progress); pos.push(h.x, h.y, h.z); }
    const visible = progress > 0.0005 && pos.length >= 6;
    for (const l of Object.values(lines)) {
      l.visible = visible;
      if (!visible) continue;
      l.geometry.dispose();
      const g = new LineGeometry();
      g.setPositions(pos);
      l.geometry = g;
      l.computeLineDistances();
      (l.material as LineMaterial).resolution.set(size.width, size.height);
    }
    (lines.core.material as LineMaterial).linewidth = R.width * scale;
    (lines.xray.material as LineMaterial).linewidth = R.width * 0.8 * scale;
    (lines.glow.material as LineMaterial).linewidth = R.glowWidth * scale;
  }, [progress, route, lines, size, scale]);

  return (
    <>
      <primitive object={lines.glow} />
      <primitive object={lines.core} />
      <primitive object={lines.xray} />
    </>
  );
};
