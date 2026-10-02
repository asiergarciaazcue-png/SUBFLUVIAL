import { useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo } from "react";
import { continueRender, delayRender, staticFile } from "remotion";
import * as THREE from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { TilesRenderer } from "3d-tiles-renderer";
import { GLTFExtensionsPlugin } from "3d-tiles-renderer/plugins";
import { CONFIG } from "../data/config";
import { Territory as TerritoryData } from "../data/route";
import type { Pose } from "./CameraRig";

const G = CONFIG.google;

/* ECEF (WGS84) → marco local del trazado: x a lo largo del eje Artaza → Ballonti, y arriba, z a la derecha.
   El origen se sitúa a la altura elipsoidal del nivel del mar (ondulación del geoide) para que y = 0 sea el agua. */
function ecefToLocal(T: TerritoryData) {
  const { lat0, lon0, fe, fn } = T.meta;
  const a = 6378137, f = 1 / 298.257223563, e2 = f * (2 - f);
  const la = THREE.MathUtils.degToRad(lat0), lo = THREE.MathUtils.degToRad(lon0), h = G.geoid;
  const N = a / Math.sqrt(1 - e2 * Math.sin(la) ** 2);
  const O = new THREE.Vector3((N + h) * Math.cos(la) * Math.cos(lo), (N + h) * Math.cos(la) * Math.sin(lo), (N * (1 - e2) + h) * Math.sin(la));
  const E = new THREE.Vector3(-Math.sin(lo), Math.cos(lo), 0);
  const No = new THREE.Vector3(-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la));
  const U = new THREE.Vector3(Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la));
  const X = E.clone().multiplyScalar(fe).addScaledVector(No, fn);
  const Z = E.clone().multiplyScalar(fn).addScaledVector(No, -fe);
  const m = new THREE.Matrix4().set(X.x, X.y, X.z, 0, U.x, U.y, U.z, 0, Z.x, Z.y, Z.z, 0, 0, 0, 0, 1);
  const t = O.clone().applyMatrix4(m).negate();
  m.setPosition(t);
  return m;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* Google Photorealistic 3D Tiles servidas por el proxy local (scripts/tiles-proxy.mjs añade la clave).
   En cada fotograma se espera a que estén cargadas todas las teselas necesarias para esa cámara. */
export const GoogleTiles: React.FC<{ data: TerritoryData; pose: Pose }> = ({ data, pose }) => {
  const { camera, gl, scene, size } = useThree();
  const tiles = useMemo(() => {
    const t = new TilesRenderer(`${G.proxy}/v1/3dtiles/root.json`);
    const draco = new DRACOLoader().setDecoderPath(staticFile("draco/"));
    t.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco }));
    t.errorTarget = G.errorTarget;
    t.group.matrixAutoUpdate = false;
    t.group.matrix.copy(ecefToLocal(data));
    t.group.updateMatrixWorld(true);
    t.lruCache.minSize = 3000;
    t.lruCache.maxSize = 6000;
    return t;
  }, [data]);

  useLayoutEffect(() => {
    tiles.setCamera(camera);
    tiles.setResolution(camera, size.width, size.height);
    return () => { tiles.deleteCamera(camera); };
  }, [tiles, camera, size]);

  useLayoutEffect(() => () => tiles.dispose(), [tiles]);

  useLayoutEffect(() => {
    const handle = delayRender("Cargando teselas 3D de Google", { timeoutInMilliseconds: 600000 });
    let cancelled = false;
    (async () => {
      camera.updateMatrixWorld();
      let calm = 0;
      for (let i = 0; i < 6000 && !cancelled; i++) {
        tiles.update();
        const s = (tiles as any).stats;
        const busy = (tiles as any).isLoading || s.queued + s.downloading + s.parsing > 0;
        calm = busy ? 0 : calm + 1;
        if (calm >= 4 && tiles.root) break;
        await sleep(busy ? 40 : 20);
      }
      gl.render(scene, camera);
      continueRender(handle);
    })();
    return () => { cancelled = true; };
  }, [pose, tiles, camera, gl, scene]);

  return <primitive object={tiles.group} />;
};
