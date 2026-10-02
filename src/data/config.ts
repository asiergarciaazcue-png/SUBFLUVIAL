import geo from "./geo.json";

/* =====================================================================
   CONFIG central — coordenadas, colores, timings y cámara.
   Todo lo que se ajusta en revisión vive aquí.
   ===================================================================== */
export const CONFIG = {
  id: "ArtazaBallonti",
  durationSeconds: 20,
  fps: 30,
  width: 1920,
  height: 1080,

  // Coordenadas verificadas sobre los datos reales (centro de la rotonda / centro comercial).
  // Se editan en src/data/geo.json porque también las usa el script de datos.
  artaza: { name: "ARTAZA", ...geo.artaza },
  ballonti: { name: "BALLONTI", ...geo.ballonti },

  colors: {
    ground: "#C5CBD0",
    groundDark: "#AEB6BC",
    groundOpen: "#C8CECD", // parques y zonas verdes: gris apenas templado
    road: "#E3E7EA",
    roadEdge: "#A9B1B7",
    rail: "#9EA7AE",
    buildingsLight: "#D9DEE2", // tejados
    buildingsMid: "#B8C0C6", // fachadas
    water: "#5A95CC",
    waterEdge: "#4A84BB",
    route: "#19F06A",
    routeHead: "#EAFFF2",
    background: "#D5DBDF",
    label: "#FFFFFF",
  },

  /* Trazado: recta entre los dos extremos (la línea es un recurso gráfico de una infraestructura
     subterránea). `bend` curva suavemente el eje (fracción de L; 0 = recta). */
  route: {
    bend: 0,
    lift: 3, // m sobre el terreno (es gráfica, no carretera)
    width: 7, // px a 1080p — grosor estable en pantalla
    glowWidth: 22, // px
    glowOpacity: 0.22,
    xray: 0.8, // opacidad del tramo oculto tras edificios (lectura «radiografía»)
    markerSize: 18, // px — puntos de origen/destino
    /* Paso subfluvial: bajo la ría la línea desciende de forma simbólica y vuelve a subir en la otra orilla.
       Solo se aplica a láminas de agua de más de `minWater` m a lo largo del trazado (la ría, no los arroyos). */
    dip: { depth: 34, ramp: 170, minWater: 80 }, // m
  },

  /* Crecimiento de la línea: t (s) → fracción del trazado dibujada (0–1).
     Nace a los 3 s en el centro de la rotonda y llega a Ballonti a los 17,6 s.
     Ritmo continuo: no cambia al cruzar la ría. */
  line: [
    { t: 0, v: 0 },
    { t: 3.0, v: 0 },
    { t: 4.6, v: 0.07 },
    { t: 7.0, v: 0.3 },
    { t: 10.0, v: 0.53 },
    { t: 13.0, v: 0.74 },
    { t: 16.0, v: 0.93 },
    { t: 17.6, v: 1 },
    { t: 20, v: 1 },
  ],
  labels: {
    artazaIn: 0.3, // s — etiqueta ARTAZA visible desde el arranque
    ballontiIn: 16.6, // s — BALLONTI aparece al reconocerse el destino
    fadeSeconds: 0.8,
  },

  /* Cámara por keyframes (frame a 30 fps):
       along   punto del trazado al que mira la cámara (0 = Artaza, 1 = Ballonti)
       range   distancia al punto (m)
       tilt    inclinación desde la vertical (0° = cenital)
       heading 0° = mirar perpendicular al trazado; + = mirar hacia Ballonti
       fov     campo de visión horizontal (°) */
  camera: [
    { frame: 0, along: 0.0, range: 700, tilt: 66, heading: 35, fov: 44 },
    { frame: 60, along: 0.02, range: 640, tilt: 70, heading: 42, fov: 46 },
    { frame: 120, along: 0.06, range: 560, tilt: 73, heading: 50, fov: 50 },
    { frame: 150, along: 0.11, range: 520, tilt: 74, heading: 52, fov: 52 },
    { frame: 210, along: 0.28, range: 600, tilt: 72, heading: 54, fov: 54 },
    { frame: 300, along: 0.5, range: 720, tilt: 69, heading: 58, fov: 54 },
    { frame: 390, along: 0.7, range: 560, tilt: 73, heading: 55, fov: 54 },
    { frame: 480, along: 0.88, range: 640, tilt: 70, heading: 48, fov: 52 },
    { frame: 540, along: 0.97, range: 820, tilt: 66, heading: 42, fov: 50 },
    { frame: 599, along: 0.47, range: 3900, tilt: 57, heading: 47, fov: 50 },
  ],
  camClearance: 40, // m mínimos sobre el terreno

  /* Acabado REALISTA (composición ArtazaBallontiRealista): ortofoto sobre el relieve y los tejados,
     fachadas, cielo y bruma atmosférica. Sin textos. Ortofoto: scripts/fetch_ortho.py → public/ortho/ */
  real: {
    labels: false,
    skyTop: "#86ABD2",
    skyHorizon: "#D4DEE6",
    haze: "#D4DEE6", // color de la bruma atmosférica y del límite de los datos
    fog: { near: 1800, far: 8500, edge: 1100 },
    facade: "#B5AEA2", // tono base de fachadas (se mezcla con el color del tejado)
    facadeMix: 0.45,
    windows: 0.2, // intensidad del patrón de ventanas (0 = fachadas lisas)
    exposure: 1.0,
    light: { sun: 2.1, sunColor: "#FFF4E2", hemi: 1.05, sky: "#CFE0F2", ground: "#8C8676", fill: 0.15, dir: [-0.5, 0.75, 0.6] as [number, number, number] },
  },

  light: {
    sun: 1.25,
    hemi: 0.95,
    fill: 0.18,
    dir: [-0.45, 0.8, 0.85] as [number, number, number],
    shadowMap: 4096,
  },
  fog: { near: 2400, far: 9000, edge: 900 }, // el territorio se pierde en la bruma, sin borde ni peana
  groundTexture: { width: 8192, height: 6144 },
  vignette: 0.12,
};

export type CameraKey = (typeof CONFIG.camera)[number];
