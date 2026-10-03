import geo from "./geo.json";

/* =====================================================================
   CONFIG central — coordenadas, colores, timings y cámara.
   Todo lo que se ajusta en revisión vive aquí.
   ===================================================================== */
export const CONFIG = {
  id: "ArtazaBallonti",
  durationSeconds: 26, // 3 s fijos + 20 s de animación + 3 s fijos (ver holdStart / holdEnd)
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
    dip: { depth: 26, ramp: 170, minWater: 80 }, // m (adicional a la profundidad del túnel)
    /* Infraestructura subterránea: túnel a `depth` m bajo el terreno en todo el recorrido, pozos verticales
       en los extremos, cortina de sección translúcida hasta la superficie y traza discontinua en superficie. */
    underground: {
      enabled: true,
      depth: 40, // m bajo el terreno
      rampAngle: 45, // ° — pendiente máxima de la bajada en Artaza y la subida en Ballonti
      shaftPoints: 0, // >0 añade pozos verticales a 90° en los extremos (alternativa a las rampas)
      lineOpacity: 1, // la línea se ve a través del terreno (lectura de radiografía)
      curtainOpacity: 0.42, // opacidad de la cortina de sección en la cota del túnel (se desvanece hacia arriba)
      surfaceTrace: 0.75, // opacidad de la traza discontinua en superficie
      surfaceDash: [14, 10] as [number, number], // m — trazo / hueco
    },
    /* Túnel con volumen: tubo 3D a escala, en radiografía, con anillos de dovelas */
    tunnel: {
      enabled: true,
      diameter: 10, // m — PENDIENTE de confirmar con el cliente
      ringSpacing: 12, // m — separación visual de los anillos (simbólica; la dovela real ≈ 1,5–2 m no se percibe a esta distancia)
      opacity: 0.38, // cuerpo del tubo
      rim: 0.75, // brillo de los bordes (efecto radiografía)
      ringStrength: 0.55,
      coreWidth: 2.4, // px — eje fino dentro del tubo para que se lea también en planos lejanos
    },
    /* Corte de sección en la ría: al llegar la línea al cruce, el agua y el terreno se «abren» en un plano vertical */
    section: {
      enabled: true,
      waterDepth: 10, // m — calado aproximado de la ría (PENDIENTE de confirmar)
      sediment: 12, // m — espesor de fangos/arenas bajo el lecho
      below: 18, // m de terreno visibles bajo el túnel
      margin: 60, // m de corte en tierra a cada lado de la ría
      openAhead: 0.03, // fracción del trazado antes de la ría en la que empieza a abrirse
      openDuration: 0.05, // fracción del trazado que dura la apertura
      opacity: 0.93,
      colors: { waterTop: "#3E86C6", waterBottom: "#1C4E7A", bed: "#C9B48A", sediment: "#8E7A5A", rock: "#5C5852", rockLine: "#4A4741", edge: "#E9F6FF" },
    },
    /* Modo radiografía de la ciudad mientras avanza la línea (solo acabado Google) */
    xrayCity: { desaturate: 0.6, darken: 0.2, in: [2.6, 4.6] as [number, number], out: [18.0, 19.6] as [number, number] }, // s de animación
  },
  /* Márgenes de edición: segundos fijos antes de empezar y después de terminar la animación */
  holdStart: 3,
  holdEnd: 3,

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
  /* Cámara CINEMATOGRÁFICA (prop camera="cine"): grúa de apertura, seguimiento bajo de la punta,
     plano lateral casi de perfil al cruzar la ría y grúa final de revelado. Rumbo relativo al sentido de avance. */
  cameraCine: [
    { frame: 0, along: 0.0, range: 1150, tilt: 56, heading: 22, fov: 40 }, // plano general alto
    { frame: 75, along: 0.0, range: 560, tilt: 66, heading: 38, fov: 42 }, // grúa descendente sobre la rotonda
    { frame: 120, along: 0.045, range: 400, tilt: 72, heading: 58, fov: 46 }, // la línea entra en rampa
    { frame: 180, along: 0.2, range: 430, tilt: 75, heading: 66, fov: 50 }, // seguimiento bajo
    { frame: 228, along: 0.32, range: 520, tilt: 77, heading: 28, fov: 50 }, // giro hacia el perfil
    { frame: 275, along: 0.44, range: 580, tilt: 79, heading: 8, fov: 50 }, // perfil: la línea pasa bajo la ría
    { frame: 320, along: 0.56, range: 520, tilt: 76, heading: 34, fov: 50 },
    { frame: 390, along: 0.74, range: 470, tilt: 74, heading: 60, fov: 50 }, // seguimiento
    { frame: 470, along: 0.92, range: 520, tilt: 70, heading: 46, fov: 48 }, // llegada a Artaza
    { frame: 510, along: 0.985, range: 640, tilt: 66, heading: 36, fov: 46 },
    { frame: 599, along: 0.48, range: 3900, tilt: 57, heading: 42, fov: 50 }, // grúa final: conexión completa
  ],
  camClearance: 40, // m mínimos sobre el terreno

  /* Google Photorealistic 3D Tiles (composición ArtazaBallontiGoogle). Requiere el proxy local en marcha:
       NODE_USE_ENV_PROXY=1 node scripts/tiles-proxy.mjs   (clave en .env.local, nunca en el repo) */
  google: {
    proxy: "http://localhost:8787",
    geoid: 52, // m — ondulación del geoide en el Abra (altura elipsoidal del nivel del mar)
    errorTarget: 6, // px — menor = más detalle (y más descargas)
    attribution: true, // Google exige mostrar la atribución de los datos
  },

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
