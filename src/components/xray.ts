import * as THREE from "three";
import { CONFIG } from "../data/config";

/* Modo radiografía de la ciudad: desaturar y oscurecer suavemente las teselas (uniforme compartido) */
export const XRAY = { uDesat: { value: 0 }, uDark: { value: 0 } };
export function patchMaterial(m: THREE.Material) {
  if ((m as any).__xray) return;
  (m as any).__xray = true;
  const prev = m.onBeforeCompile.bind(m);
  m.onBeforeCompile = (sh, r) => {
    prev(sh, r);
    Object.assign(sh.uniforms, XRAY);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uDesat; uniform float uDark;")
      .replace("#include <dithering_fragment>", `#include <dithering_fragment>
        float lum = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(lum), uDesat) * (1.0 - uDark);`);
  };
  const prevKey = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => prevKey() + "|xray";
  m.needsUpdate = true;
}


export const setXray = (amount: number) => {
  XRAY.uDesat.value = CONFIG.route.xrayCity.desaturate * amount;
  XRAY.uDark.value = CONFIG.route.xrayCity.darken * amount;
};
