import { useLayoutEffect, useMemo } from "react";
import * as THREE from "three";
import { CONFIG } from "../data/config";
import { Route } from "../data/route";

const T = CONFIG.route.tunnel;

/* Tubo del túnel a escala (diámetro real), en radiografía: cuerpo translúcido, bordes luminosos
   (fresnel) y anillos de dovelas fijos en el espacio mientras el tubo crece. */
const vert = /* glsl */ `
  uniform float uLen;
  varying float vS;
  varying vec3 vN, vV;
  void main() {
    vS = uv.x * uLen; // metros desde el inicio del trazado (TubeGeometry parametriza por longitud de arco)
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const frag = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity, uRim, uRing, uSpacing;
  varying float vS;
  varying vec3 vN, vV;
  void main() {
    float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
    float rim = pow(f, 2.2);
    float ring = 1.0 - smoothstep(0.0, 0.07, abs(fract(vS / uSpacing) - 0.5) * 2.0 - 0.86);
    ring = clamp(ring, 0.0, 1.0);
    float a = uOpacity * (0.35 + 0.65 * rim) + uRim * rim * 0.6 + uRing * ring * (0.25 + 0.75 * rim);
    vec3 col = mix(uColor, vec3(0.86, 1.0, 0.92), rim * 0.55 + ring * 0.25);
    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
    #include <colorspace_fragment>
  }
`;

export const TunnelTube: React.FC<{ route: Route; progress: number }> = ({ route, progress }) => {
  const mesh = useMemo(() => {
    const m = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
      uniforms: {
        uColor: { value: new THREE.Color(CONFIG.colors.route) }, uOpacity: { value: T.opacity }, uRim: { value: T.rim },
        uRing: { value: T.ringStrength }, uSpacing: { value: T.ringSpacing }, uLen: { value: 1 },
      },
    });
    const o = new THREE.Mesh(new THREE.BufferGeometry(), m);
    o.renderOrder = 10;
    o.frustumCulled = false;
    return o;
  }, []);

  useLayoutEffect(() => {
    const N = route.pts.length, f = progress * (N - 1), n = Math.floor(f);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= n && i < N; i++) pts.push(new THREE.Vector3(route.pts[i].x, route.pts[i].y, route.pts[i].z));
    if (f > n && n < N - 1) { const h = route.at(progress); pts.push(new THREE.Vector3(h.x, h.y, h.z)); }
    // quitar puntos casi coincidentes (evitan tangentes degeneradas)
    const clean = pts.filter((p, i) => i === 0 || p.distanceTo(pts[i - 1]) > 0.05);
    mesh.visible = T.enabled && clean.length >= 2;
    if (!mesh.visible) return;
    const curve = new THREE.CatmullRomCurve3(clean, false, "centripetal");
    const len = curve.getLength();
    const g = new THREE.TubeGeometry(curve, Math.max(8, Math.min(1600, Math.round(len / 3))), T.diameter / 2, 20, false);
    mesh.geometry.dispose();
    mesh.geometry = g;
    (mesh.material as THREE.ShaderMaterial).uniforms.uLen.value = len;
  }, [route, progress, mesh]);

  return <primitive object={mesh} />;
};
