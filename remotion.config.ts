import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(95);
// WebGL en el render headless (three.js)
Config.setChromiumOpenGlRenderer("angle");
Config.setConcurrency(2);
Config.setDelayRenderTimeoutInMilliseconds(120000);
// Si el entorno no puede descargar Chrome Headless Shell, apunta a un Chromium local:
//   REMOTION_BROWSER=/ruta/a/chrome npx remotion studio
if (process.env.REMOTION_BROWSER) Config.setBrowserExecutable(process.env.REMOTION_BROWSER);
