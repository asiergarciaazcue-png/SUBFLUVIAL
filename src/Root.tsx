import { Composition } from "remotion";
import { ArtazaBallonti } from "./ArtazaBallonti";
import { CONFIG } from "./data/config";

export const RemotionRoot: React.FC = () => (
  <Composition
    id={CONFIG.id}
    component={ArtazaBallonti}
    durationInFrames={CONFIG.durationSeconds * CONFIG.fps}
    fps={CONFIG.fps}
    width={CONFIG.width}
    height={CONFIG.height}
  />
);
