import { ThreeCanvas } from "@remotion/three";
import React, { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { AbsoluteFill, cancelRender, continueRender, delayRender, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { CameraRig, cameraPose, lineProgress, projector } from "./components/CameraRig";
import { GlowDot, MarkerLabel } from "./components/MarkerLabel";
import { RouteLine } from "./components/RouteLine";
import { Territory } from "./components/Territory";
import { CONFIG } from "./data/config";
import { makeRoute, smooth01, Territory as TerritoryData } from "./data/route";

const useTerritory = () => {
  const [data, setData] = useState<TerritoryData | null>(null);
  const [handle] = useState(() => delayRender("Cargando territorio real (public/territory.json)", { timeoutInMilliseconds: 120000 }));
  useEffect(() => {
    fetch(staticFile("territory.json"))
      .then((r) => r.json())
      .then((j: TerritoryData) => { setData(j); continueRender(handle); })
      .catch((e) => cancelRender(e));
  }, [handle]);
  return data;
};

export const ArtazaBallonti: React.FC = () => {
  const data = useTerritory();
  if (!data) return <AbsoluteFill style={{ background: CONFIG.colors.background }} />;
  return <Scene data={data} />;
};

const Scene: React.FC<{ data: TerritoryData }> = ({ data }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const t = frame / fps;
  const aspect = width / height;
  const route = useMemo(() => makeRoute(data), [data]);
  const pose = useMemo(() => cameraPose(frame, route, aspect), [frame, route, aspect]);
  const progress = THREE.MathUtils.clamp(lineProgress(t), 0, 1);

  // posiciones 2D para puntos y etiquetas
  const P = projector(pose, aspect);
  const sA = P(route.start.x, route.start.y, route.start.z);
  const sB = P(route.end.x, route.end.y, route.end.z);
  const head = route.at(progress), sH = P(head.x, head.y, head.z);
  const L = CONFIG.labels;
  const aIn = smooth01((t - L.artazaIn) / L.fadeSeconds);
  const bIn = smooth01((t - L.ballontiIn) / L.fadeSeconds);
  const startDot = smooth01((t - (CONFIG.line[1].t - 0.4)) / 0.6);
  const endDot = smooth01((progress - 0.985) / 0.015);

  return (
    <AbsoluteFill style={{ background: CONFIG.colors.background }}>
      <ThreeCanvas width={width} height={height} shadows flat gl={{ antialias: true, preserveDrawingBuffer: true }} camera={{ fov: 40, near: 5, far: 80000 }}>
        <CameraRig pose={pose} />
        <Territory data={data} pose={pose} />
        <RouteLine route={route} progress={progress} />
      </ThreeCanvas>
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        {sA.visible && <GlowDot x={sA.x} y={sA.y} size={CONFIG.route.markerSize} opacity={startDot} />}
        {sB.visible && <GlowDot x={sB.x} y={sB.y} size={CONFIG.route.markerSize} opacity={endDot} />}
        {sH.visible && <GlowDot x={sH.x} y={sH.y} size={CONFIG.route.markerSize * 0.62} opacity={progress > 0.001 && progress < 0.985 ? 1 : 0} />}
        {sA.visible && <MarkerLabel x={sA.x} y={sA.y} text={CONFIG.artaza.name} opacity={aIn} />}
        {sB.visible && <MarkerLabel x={sB.x} y={sB.y} text={CONFIG.ballonti.name} opacity={bIn} />}
      </AbsoluteFill>
      <AbsoluteFill style={{ pointerEvents: "none", background: `radial-gradient(ellipse at center, rgba(8,24,28,0) 58%, rgba(8,24,28,${CONFIG.vignette}) 100%)` }} />
    </AbsoluteFill>
  );
};
