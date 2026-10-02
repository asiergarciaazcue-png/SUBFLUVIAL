import { ThreeCanvas } from "@remotion/three";
import React, { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { AbsoluteFill, cancelRender, continueRender, delayRender, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { CameraRig, cameraPose, lineProgress, projector } from "./components/CameraRig";
import { GlowDot, MarkerLabel } from "./components/MarkerLabel";
import { RouteLine } from "./components/RouteLine";
import { Territory } from "./components/Territory";
import { Ortho, TerritoryReal } from "./components/TerritoryReal";
import { GoogleTiles } from "./components/GoogleTiles";
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

/* Ortofoto troceada (public/ortho/ortho.json + teselas JPG), cargada como texturas */
const useOrtho = (enabled: boolean) => {
  const [ortho, setOrtho] = useState<Ortho | null>(null);
  const [handle] = useState(() => (enabled ? delayRender("Cargando ortofoto (public/ortho)", { timeoutInMilliseconds: 180000 }) : null));
  useEffect(() => {
    if (!enabled || handle === null) return;
    (async () => {
      const o: Ortho = await (await fetch(staticFile("ortho/ortho.json"))).json();
      const loader = new THREE.TextureLoader();
      await Promise.all(o.tiles.map(async (t) => {
        const tex = await loader.loadAsync(staticFile(`ortho/${t.file}`));
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.flipY = false;
        tex.anisotropy = 16;
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        t.texture = tex;
      }));
      setOrtho(o);
      continueRender(handle);
    })().catch((e) => cancelRender(e));
  }, [enabled, handle]);
  return ortho;
};

export type Look = "estilizado" | "realista" | "google";

export const ArtazaBallonti: React.FC<{ look?: Look }> = ({ look = "estilizado" }) => {
  const data = useTerritory();
  const ortho = useOrtho(look === "realista");
  if (!data || (look === "realista" && !ortho)) return <AbsoluteFill style={{ background: CONFIG.colors.background }} />;
  return <Scene data={data} look={look} ortho={ortho} />;
};

const Scene: React.FC<{ data: TerritoryData; look: Look; ortho: Ortho | null }> = ({ data, look, ortho }) => {
  const google = look === "google";
  const real = look === "realista" || google;
  const showLabels = real ? CONFIG.real.labels : true;
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
    <AbsoluteFill style={{ background: real ? `linear-gradient(180deg, ${CONFIG.real.skyTop} 0%, ${CONFIG.real.skyHorizon} 38%, ${CONFIG.real.haze} 100%)` : CONFIG.colors.background }}>
      <ThreeCanvas width={width} height={height} shadows flat gl={{ antialias: true, preserveDrawingBuffer: true, alpha: true }} camera={{ fov: 40, near: 5, far: 80000 }}>
        <CameraRig pose={pose} />
        {google ? (
          <>
            <fog attach="fog" args={[CONFIG.real.haze, CONFIG.real.fog.near, CONFIG.real.fog.far * 1.6]} />
            <GoogleTiles data={data} pose={pose} />
          </>
        ) : real && ortho ? <TerritoryReal data={data} ortho={ortho} pose={pose} /> : <Territory data={data} pose={pose} />}
        <RouteLine route={route} progress={progress} />
      </ThreeCanvas>
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        {sA.visible && <GlowDot x={sA.x} y={sA.y} size={CONFIG.route.markerSize} opacity={startDot} />}
        {sB.visible && <GlowDot x={sB.x} y={sB.y} size={CONFIG.route.markerSize} opacity={endDot} />}
        {sH.visible && <GlowDot x={sH.x} y={sH.y} size={CONFIG.route.markerSize * 0.62} opacity={progress > 0.001 && progress < 0.985 ? 1 : 0} />}
        {showLabels && sA.visible && <MarkerLabel x={sA.x} y={sA.y} text={CONFIG.artaza.name} opacity={aIn} />}
        {showLabels && sB.visible && <MarkerLabel x={sB.x} y={sB.y} text={CONFIG.ballonti.name} opacity={bIn} />}
      </AbsoluteFill>
      {google && CONFIG.google.attribution && (
        <div style={{ position: "absolute", right: 22, bottom: 16, fontFamily: "Arial, sans-serif", fontSize: 15, color: "rgba(255,255,255,.85)", textShadow: "0 1px 2px rgba(0,0,0,.6)" }}>
          Google · Datos del mapa ©{new Date().getFullYear()} Google
        </div>
      )}
      <AbsoluteFill style={{ pointerEvents: "none", background: `radial-gradient(ellipse at center, rgba(8,24,28,0) 58%, rgba(8,24,28,${CONFIG.vignette}) 100%)` }} />
    </AbsoluteFill>
  );
};
