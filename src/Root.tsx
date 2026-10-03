import { Composition } from "remotion";
import { ArtazaBallonti } from "./ArtazaBallonti";
import { EarthOverlay } from "./EarthOverlay";
import { CONFIG } from "./data/config";

const common = {
  durationInFrames: CONFIG.durationSeconds * CONFIG.fps,
  fps: CONFIG.fps,
  width: CONFIG.width,
  height: CONFIG.height,
};

export const RemotionRoot: React.FC = () => (
  <>
    {/* Acabado estilizado (grises tipo Google Maps 3D, con etiquetas) */}
    <Composition id={CONFIG.id} component={ArtazaBallonti} defaultProps={{ look: "estilizado" as const }} {...common} />
    {/* Acabado realista tipo Google Earth (ortofoto, sin textos) */}
    <Composition id={`${CONFIG.id}Realista`} component={ArtazaBallonti} defaultProps={{ look: "realista" as const }} {...common} />
    {/* Google Photorealistic 3D Tiles (requiere scripts/tiles-proxy.mjs y clave en .env.local), sin textos */}
    <Composition id={`${CONFIG.id}Google`} component={ArtazaBallonti} defaultProps={{ look: "google" as const }} {...common} />
    {/* Recorrido inverso Ballonti → Artaza, acabado estilizado (sin depender de Google) */}
    <Composition id="BallontiArtaza" component={ArtazaBallonti} defaultProps={{ look: "estilizado" as const, reverse: true, labels: false }} {...common} />
    {/* Recorrido inverso Ballonti → Artaza sobre ortofoto PNOA (IGN), sin textos */}
    <Composition id="BallontiArtazaRealista" component={ArtazaBallonti} defaultProps={{ look: "realista" as const, reverse: true, labels: false }} {...common} />
    {/* Ballonti → Artaza, ortofoto PNOA, cámara cinematográfica, sin textos */}
    <Composition id="BallontiArtazaRealistaCine" component={ArtazaBallonti} defaultProps={{ look: "realista" as const, reverse: true, labels: false, camera: "cine" as const }} {...common} />
    {/* Recorrido inverso Ballonti → Artaza sobre Google 3D (cámara por el otro lado; la línea crece de izquierda a derecha) */}
    <Composition id="BallontiArtazaGoogle" component={ArtazaBallonti} defaultProps={{ look: "google" as const, reverse: true, labels: false, camera: "cine" as const }} {...common} />
    {/* Línea subterránea superpuesta a un render de Google Earth Studio (cámara del 3D tracking data) */}
    <Composition id="BallontiArtazaEarth" component={EarthOverlay} defaultProps={{ video: "earth/ballonti-artaza-cine.mp4", camera: "earth/camera.json", reverse: true }} {...common} />
  </>
);
