import T from "../../public/territory.json";
import { makeRoute } from "../../src/data/route";
import { cameraPose } from "../../src/components/CameraRig";
import { CONFIG } from "../../src/data/config";
import fs from "node:fs";
const t: any = T; const m = t.meta;
const route = makeRoute(t, 1200, true);
const toLL = (x: number, z: number) => { const e = x * m.fe + z * m.fn, n = x * m.fn - z * m.fe; return { lat: m.lat0 + n / m.ky, lon: m.lon0 + e / m.kx }; };
const fps = 30, total = CONFIG.durationSeconds * fps, hold = CONFIG.holdStart * fps, anim = (CONFIG.durationSeconds - CONFIG.holdStart - CONFIG.holdEnd) * fps;
const STEP = 3;
const rows: any[] = [];
for (let f = 0; f < total; f += STEP) rows.push(f);
if (rows[rows.length - 1] !== total - 1) rows.push(total - 1);
const samples = rows.map((f) => {
  const af = Math.min(Math.max(f - hold, 0), anim - 1);
  const p = cameraPose(af, route, 16 / 9, "cine");
  const ll = toLL(p.position.x, p.position.z);
  const d = p.target.clone().sub(p.position);
  const de = d.x * m.fe + d.z * m.fn, dn = d.x * m.fn - d.z * m.fe;
  const heading = ((Math.atan2(de, dn) * 180) / Math.PI + 360) % 360;
  const tilt = 90 - (Math.atan2(-d.y, Math.hypot(de, dn)) * 180) / Math.PI;
  return { f, lat: ll.lat, lon: ll.lon, alt: p.position.y, heading, tilt, fovV: p.fovV };
});
// heading continuo (sin saltos 359→0)
for (let i = 1; i < samples.length; i++) { while (samples[i].heading - samples[i - 1].heading > 180) samples[i].heading -= 360; while (samples[i].heading - samples[i - 1].heading < -180) samples[i].heading += 360; }
const tr = { x: 0, y: 0, influence: 0, type: "linear" };
const attr = (type: string, min: number, max: number, val: (s: any) => number) => ({
  type, value: { maxValueRange: max, minValueRange: min }, length: 1, visible: true,
  keyframes: samples.map((s) => ({ time: s.f / (total - 1), value: (val(s) - min) / (max - min), transitionIn: tr, transitionOut: tr })),
});
const esp = {
  modelVersion: 16,
  settings: { name: "Ballonti-Artaza-cine", frameRate: fps, dimensions: { width: 1920, height: 1080 }, duration: total, timeFormat: "frames" },
  scenes: [{
    animationModel: { roving: false, logarithmic: false, groupedPosition: true },
    duration: total,
    attributes: [
      { type: "cameraGroup", attributes: [
        { type: "cameraPositionGroup", attributes: [
          { type: "position", attributes: [
            attr("longitude", -180, 180, (s) => s.lon),
            attr("latitude", -89.9999, 89.9999, (s) => s.lat),
            attr("altitude", 1, 65117481, (s) => s.alt),
          ] },
        ] },
        { type: "cameraRotationGroup", attributes: [
          attr("rotationX", 0, 360, (s) => ((s.heading % 360) + 360) % 360),
          attr("rotationY", 0, 180, (s) => s.tilt),
        ] },
      ] },
      { type: "fovEffect", attributes: [ attr("fov", 1e-5, 179.99999, (s) => s.fovV) ] },
    ],
  }],
};
fs.writeFileSync("docs/ballonti-artaza-cine.esp", JSON.stringify(esp));
// CSV por fotograma (por si se prefiere otra herramienta)
fs.writeFileSync("docs/ballonti-artaza-cine_camara.csv", "frame,lat,lon,alt_m,heading_deg,tilt_deg,fov_vertical_deg\n" + samples.map((s) => [s.f, s.lat.toFixed(7), s.lon.toFixed(7), s.alt.toFixed(1), (((s.heading % 360) + 360) % 360).toFixed(2), s.tilt.toFixed(2), s.fovV.toFixed(2)].join(",")).join("\n") + "\n");
console.log("keyframes", samples.length);
