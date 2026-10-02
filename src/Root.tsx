import { Composition } from "remotion";
import { ArtazaBallonti } from "./ArtazaBallonti";
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
  </>
);
