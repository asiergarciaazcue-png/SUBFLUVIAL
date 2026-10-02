import { loadFont } from "@remotion/fonts";
import React from "react";
import { staticFile } from "remotion";
import { CONFIG } from "../data/config";

// Instrument Sans (SIL OFL) incluida en public/fonts: el render no depende de servicios externos
const fontFamily = "Instrument Sans";
loadFont({ family: fontFamily, url: staticFile("fonts/instrument-sans-latin-600-normal.woff2"), weight: "600" });

/* Punto luminoso (origen, destino o punta de la línea) en coordenadas de pantalla normalizadas */
export const GlowDot: React.FC<{ x: number; y: number; size: number; opacity: number; core?: string }> = ({ x, y, size, opacity, core }) => {
  if (opacity <= 0.001) return null;
  const s = size * (CONFIG.height / 1080);
  return (
    <div style={{ position: "absolute", left: `${x * 100}%`, top: `${y * 100}%`, width: 0, height: 0, opacity }}>
      <div style={{
        position: "absolute", left: -s * 1.6, top: -s * 1.6, width: s * 3.2, height: s * 3.2, borderRadius: "50%",
        background: `radial-gradient(circle, ${CONFIG.colors.route}66 0%, ${CONFIG.colors.route}22 45%, transparent 70%)`,
      }} />
      <div style={{
        position: "absolute", left: -s / 2, top: -s / 2, width: s, height: s, borderRadius: "50%",
        background: core ?? CONFIG.colors.routeHead, boxShadow: `0 0 0 ${s * 0.18}px ${CONFIG.colors.route}`,
      }} />
    </div>
  );
};

/* Etiqueta tipográfica limpia: sin cajas, sin iconos. Solo ARTAZA y BALLONTI. */
export const MarkerLabel: React.FC<{ x: number; y: number; text: string; opacity: number }> = ({ x, y, text, opacity }) => {
  if (opacity <= 0.001) return null;
  const k = CONFIG.height / 1080;
  return (
    <div style={{
      position: "absolute", left: `${x * 100}%`, top: `${y * 100}%`, opacity,
      transform: `translate(-50%, calc(-100% - ${30 * k}px)) translateY(${(1 - opacity) * 8 * k}px)`,
      fontFamily: `"${fontFamily}", Arial, sans-serif`, fontWeight: 600, fontSize: 34 * k, letterSpacing: `${0.22 * 34 * k}px`, color: CONFIG.colors.label,
      textShadow: "0 1px 2px rgba(8,22,28,.55), 0 0 18px rgba(8,22,28,.45)", whiteSpace: "nowrap", paddingLeft: 0.22 * 34 * k,
    }}>
      {text}
    </div>
  );
};
