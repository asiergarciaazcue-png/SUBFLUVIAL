import { useThree } from "@react-three/fiber";
import { useLayoutEffect } from "react";
import * as THREE from "three";
import { CONFIG } from "../data/config";
import { clamp, Route } from "../data/route";

const D2R = Math.PI / 180;

/* Interpolación cúbica monótona (sin rebotes ni sobrepasos entre keyframes) */
export function monotone(T: number[], V: number[]) {
  const n = T.length, d: number[] = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d[i] = (V[i + 1] - V[i]) / (T[i + 1] - T[i]);
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); m[i] = k * a * d[i]; m[i + 1] = k * b * d[i]; }
  }
  return (t: number) => {
    if (t <= T[0]) return V[0];
    if (t >= T[n - 1]) return V[n - 1];
    let i = 0;
    while (t > T[i + 1]) i++;
    const h = T[i + 1] - T[i], u = (t - T[i]) / h, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * V[i] + (u3 - 2 * u2 + u) * h * m[i] + (-2 * u3 + 3 * u2) * V[i + 1] + (u3 - u2) * h * m[i + 1];
  };
}

const keys = CONFIG.camera;
const F = keys.map((k) => k.frame);
const curves = {
  along: monotone(F, keys.map((k) => k.along)),
  logRange: monotone(F, keys.map((k) => Math.log(k.range))), // el zoom se interpola en escala logarítmica
  tilt: monotone(F, keys.map((k) => k.tilt)),
  heading: monotone(F, keys.map((k) => k.heading)),
  fov: monotone(F, keys.map((k) => k.fov)),
};
export const lineProgress = monotone(CONFIG.line.map((k) => k.t), CONFIG.line.map((k) => k.v));

export type Pose = { position: THREE.Vector3; target: THREE.Vector3; fovV: number; range: number };

/* Pose de cámara para un fotograma: mira a un punto del trazado desde una distancia,
   inclinación y rumbo dados (rumbo relativo al eje Artaza → Ballonti). */
export function cameraPose(frame: number, route: Route, aspect: number): Pose {
  const along = clamp(curves.along(frame), 0, 1);
  const p = route.at(along);
  const range = Math.exp(curves.logRange(frame));
  const h = curves.heading(frame) * D2R, el = (90 - curves.tilt(frame)) * D2R;
  // el rumbo es relativo al sentido de avance: en el recorrido inverso la cámara gira 180°
  // (vuela por el otro lado del trazado) y la línea sigue creciendo de izquierda a derecha en pantalla
  const sgn = route.reverse ? -1 : 1;
  const dx = sgn * Math.sin(h), dz = -sgn * Math.cos(h);
  const target = new THREE.Vector3(p.x, Math.max(route.hAt(p.x, p.z), 0), p.z);
  const px = target.x - dx * Math.cos(el) * range, pz = target.z - dz * Math.cos(el) * range;
  const py = Math.max(target.y + Math.sin(el) * range, route.hAt(px, pz) + CONFIG.camClearance);
  const fovH = curves.fov(frame) * D2R;
  const fovV = (2 * Math.atan(Math.tan(fovH / 2) / aspect)) / D2R;
  return { position: new THREE.Vector3(px, py, pz), target, fovV, range };
}

/* Cámara de proyección equivalente (para colocar etiquetas en 2D sobre el vídeo) */
export function projector(pose: Pose, aspect: number) {
  const cam = new THREE.PerspectiveCamera(pose.fovV, aspect, 5, 80000);
  cam.position.copy(pose.position);
  cam.lookAt(pose.target);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return (x: number, y: number, z: number) => {
    const v = new THREE.Vector3(x, y, z).project(cam);
    return { x: (v.x + 1) / 2, y: (1 - v.y) / 2, visible: v.z < 1, depth: cam.position.distanceTo(new THREE.Vector3(x, y, z)) };
  };
}

export const CameraRig: React.FC<{ pose: Pose }> = ({ pose }) => {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  useLayoutEffect(() => {
    camera.position.copy(pose.position);
    camera.fov = pose.fovV;
    camera.aspect = size.width / size.height;
    camera.near = 5;
    camera.far = 80000;
    camera.lookAt(pose.target);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }, [camera, pose, size]);
  return null;
};
