import { useThree } from "@react-three/fiber";
import { ThreeCanvas } from "@remotion/three";
import React, { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { AbsoluteFill, cancelRender, continueRender, delayRender, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import * as THREE from "three";
import { useTerritory } from "./ArtazaBallonti";
import { lineProgress, Pose, projector } from "./components/CameraRig";
import { GlowDot } from "./components/MarkerLabel";
import { RouteLine } from "./components/RouteLine";
import { CONFIG } from "./data/config";
import { makeRoute, smooth01 } from "./data/route";

/* Superposición de la línea subterránea sobre un render de Google Earth Studio.
   La cámara sale del «3D tracking data» exportado por Earth Studio, convertido al marco del trazado con
   scripts/earth_camera.py → public/earth/camera.json. El vídeo de fondo es public/earth/<video>.mp4. */
type EarthCam = { p: number[]; r: number[]; u: number[]; f: number[]; fov: number };

const useEarthCamera = (file: string) => {
  const [data, setData] = useState<EarthCam[] | null>(null);
  const [handle] = useState(() => delayRender("Cargando cámara de Earth Studio"));
  useEffect(() => {
    fetch(staticFile(file)).then((r) => r.json()).then((j) => { setData(j.frames); continueRender(handle); }).catch((e) => cancelRender(e));
  }, [file, handle]);
  return data;
};

const toPose = (c: EarthCam): Pose & { basis: THREE.Matrix4 } => {
  const pos = new THREE.Vector3(...c.p);
  const right = new THREE.Vector3(...c.r), up = new THREE.Vector3(...c.u), fwd = new THREE.Vector3(...c.f);
  const basis = new THREE.Matrix4().makeBasis(right, up, fwd.clone().negate());
  return { position: pos, target: pos.clone().add(fwd.multiplyScalar(500)), fovV: c.fov, range: 500, basis };
};

const EarthCameraRig: React.FC<{ pose: ReturnType<typeof toPose> }> = ({ pose }) => {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  useLayoutEffect(() => {
    camera.position.copy(pose.position);
    camera.quaternion.setFromRotationMatrix(pose.basis);
    camera.fov = pose.fovV;
    camera.aspect = size.width / size.height;
    camera.near = 5;
    camera.far = 80000;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  }, [camera, pose, size]);
  return null;
};

export const EarthOverlay: React.FC<{ video: string; camera: string; reverse: boolean }> = ({ video, camera, reverse }) => {
  const data = useTerritory();
  const cams = useEarthCamera(camera);
  const rawFrame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const route = useMemo(() => (data ? makeRoute(data, 1200, reverse) : null), [data, reverse]);
  if (!data || !cams || !route) return <AbsoluteFill style={{ background: "#000" }} />;

  const animFrames = (CONFIG.durationSeconds - CONFIG.holdStart - CONFIG.holdEnd) * fps;
  const frame = Math.min(Math.max(rawFrame - CONFIG.holdStart * fps, 0), animFrames - 1);
  const t = frame / fps;
  const X = CONFIG.route.xrayCity;
  const xray = smooth01((t - X.in[0]) / (X.in[1] - X.in[0])) * (1 - smooth01((t - X.out[0]) / (X.out[1] - X.out[0])));
  const progress = THREE.MathUtils.clamp(lineProgress(t), 0, 1);
  const pose = toPose(cams[Math.min(rawFrame, cams.length - 1)]);
  const P = projector(pose, width / height);
  const sA = P(route.start.x, route.start.y, route.start.z), sB = P(route.end.x, route.end.y, route.end.z);
  const head = route.at(progress), sH = P(head.x, head.y, head.z);
  const startDot = smooth01((t - (CONFIG.line[1].t - 0.4)) / 0.6);
  const endDot = smooth01((progress - 0.985) / 0.015);
  const sat = 1 - X.desaturate * xray, bri = 1 - X.darken * xray;

  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <AbsoluteFill>
        <OffthreadVideo src={staticFile(video)} style={{ width: "100%", height: "100%", filter: `saturate(${sat}) brightness(${bri})` }} />
      </AbsoluteFill>
      <AbsoluteFill>
        <ThreeCanvas width={width} height={height} flat gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }} camera={{ fov: 20, near: 5, far: 80000 }}>
          <EarthCameraRig pose={pose} />
          <RouteLine route={route} progress={progress} />
        </ThreeCanvas>
      </AbsoluteFill>
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        {sA.visible && <GlowDot x={sA.x} y={sA.y} size={CONFIG.route.markerSize} opacity={startDot} />}
        {sB.visible && <GlowDot x={sB.x} y={sB.y} size={CONFIG.route.markerSize} opacity={endDot} />}
        {sH.visible && <GlowDot x={sH.x} y={sH.y} size={CONFIG.route.markerSize * 0.62} opacity={progress > 0.001 && progress < 0.985 ? 1 : 0} />}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
