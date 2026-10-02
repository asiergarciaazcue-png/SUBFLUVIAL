/* Renderiza fotogramas sueltos para revisar encuadres sin renderizar el vídeo completo.
   Uso: node scripts/preview-stills.mjs 0 60 120 ...   (por defecto, un fotograma por fase)
   Salida: out/stills/fNNN.png  */
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import path from "node:path";
import fs from "node:fs";

const frames = process.argv.slice(2).map(Number);
const list = frames.length ? frames : [0, 45, 90, 150, 240, 330, 420, 480, 540, 599];
const outDir = path.resolve(process.env.OUT ?? "out/stills");
fs.mkdirSync(outDir, { recursive: true });
const serveUrl = await bundle({ entryPoint: path.resolve("src/index.ts") });
const browserExecutable = process.env.REMOTION_BROWSER ?? null;
const chromiumOptions = { gl: "angle" };
const id = process.env.COMP ?? "ArtazaBallonti";
const composition = await selectComposition({ serveUrl, id, browserExecutable, chromiumOptions });
for (const frame of list) {
  const output = path.join(outDir, `f${String(frame).padStart(3, "0")}.png`);
  await renderStill({ serveUrl, composition, frame, output, browserExecutable, chromiumOptions, timeoutInMilliseconds: 120000 });
  console.log("✓", output);
}
