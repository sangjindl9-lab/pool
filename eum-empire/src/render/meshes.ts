// 절차적 로우폴리 메시 생성(외부 모델 없음). 좌표: 1칸 = 1 단위, y가 위쪽.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BuildingType } from '../engine/types';

const matCache = new Map<string, THREE.MeshStandardMaterial>();
export function mat(color: string | number, opts: { rough?: number; metal?: number; transparent?: boolean; opacity?: number; emissive?: string } = {}): THREE.MeshStandardMaterial {
  const key = `${color}|${opts.rough ?? 0.8}|${opts.metal ?? 0}|${opts.opacity ?? 1}|${opts.emissive ?? ''}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color, roughness: opts.rough ?? 0.8, metalness: opts.metal ?? 0,
      transparent: opts.transparent ?? (opts.opacity !== undefined && opts.opacity < 1), opacity: opts.opacity ?? 1,
    });
    if (opts.emissive) { m.emissive = new THREE.Color(opts.emissive); m.emissiveIntensity = 0.6; }
    matCache.set(key, m);
  }
  return m;
}

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const cylGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
const coneGeo = new THREE.ConeGeometry(0.5, 1, 8);
const prismGeo = (() => {
  // 삼각 지붕(가로 1, 높이 1, 깊이 1)
  const s = new THREE.Shape();
  s.moveTo(-0.5, 0); s.lineTo(0.5, 0); s.lineTo(0, 1); s.lineTo(-0.5, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5);
  return g;
})();

export function box(w: number, h: number, d: number, color: string | number, x = 0, y = 0, z = 0, m?: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(boxGeo, m ?? mat(color));
  mesh.scale.set(w, h, d);
  mesh.position.set(x, y + h / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
export function cyl(r: number, h: number, color: string | number, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(cylGeo, mat(color));
  mesh.scale.set(r * 2, h, r * 2);
  mesh.position.set(x, y + h / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
export function roof(w: number, h: number, d: number, color: string | number, x = 0, y = 0, z = 0, rotY = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(prismGeo, mat(color));
  mesh.scale.set(w, h, d);
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotY;
  mesh.castShadow = true;
  return mesh;
}

/**
 * 회사 건물 메시. 원점은 건물 바닥 중심, 정면은 +z 방향(도로 쪽으로 회전해 배치).
 * w,d: 칸 단위 크기
 */
export function buildingMesh(type: BuildingType, w: number, d: number, color: string): THREE.Group {
  const g = new THREE.Group();
  const iw = w - 0.3, id = d - 0.3;
  const accent = mat(color, { rough: 0.5 });
  switch (type) {
    case 'store': {
      g.add(box(iw, 0.12, id, '#bdb6a8'));
      g.add(box(iw * 0.92, 0.95, id * 0.75, '#f3efe6', 0, 0.12, -id * 0.1));
      g.add(box(iw * 0.86, 0.5, 0.05, '#7fb3d5', 0, 0.2, id * 0.28, mat('#7fb3d5', { rough: 0.15, metal: 0.3 })));
      g.add(box(iw * 0.96, 0.08, 0.45, color, 0, 0.8, id * 0.36, accent)); // 차양
      g.add(box(iw * 0.6, 0.3, 0.08, color, 0, 1.08, id * 0.27, accent)); // 간판
      g.add(box(iw * 0.92, 0.06, id * 0.75, '#8d8d8d', 0, 1.07, -id * 0.1));
      // 주차 공간
      for (let i = -1; i <= 1; i++) g.add(box(0.04, 0.01, 0.35, '#ffffff', i * 0.4, 0.12, id * 0.42));
      break;
    }
    case 'warehouse': {
      g.add(box(iw, 0.1, id, '#a6a6a0'));
      g.add(box(iw * 0.95, 1.2, id * 0.7, '#c9ced6', 0, 0.1, -id * 0.08));
      g.add(roof(iw * 0.95, 0.35, id * 0.7, '#8a96a8', 0, 1.3, -id * 0.08, Math.PI / 2 * 0));
      for (let i = 0; i < 4; i++) g.add(box(0.45, 0.65, 0.05, '#55606e', -iw * 0.36 + i * iw * 0.24, 0.1, id * 0.27));
      g.add(box(iw * 0.95, 0.12, 0.06, color, 0, 1.0, id * 0.28, accent));
      g.add(box(0.7, 0.5, 0.5, '#e8e8e8', iw * 0.3, 0.1, id * 0.4));
      break;
    }
    case 'mill': {
      g.add(box(iw, 0.1, id, '#a8a39a'));
      g.add(box(iw * 0.55, 1.4, id * 0.6, '#e4dccb', -iw * 0.18, 0.1, 0));
      g.add(roof(iw * 0.55, 0.4, id * 0.6, '#9a7b55', -iw * 0.18, 1.5, 0));
      g.add(cyl(0.38, 2.2, '#d8d8d0', iw * 0.25, 0.1, -id * 0.15));
      g.add(cyl(0.38, 2.2, '#d8d8d0', iw * 0.25, 0.1, id * 0.22));
      g.add(new THREE.Mesh(coneGeo, mat('#9a9a92')).translateX(iw * 0.25).translateY(2.45).translateZ(-id * 0.15).rotateX(0));
      g.add(box(iw * 0.55, 0.15, 0.06, color, -iw * 0.18, 1.1, id * 0.31, accent));
      break;
    }
    case 'bakery': {
      g.add(box(iw, 0.1, id, '#a8a39a'));
      g.add(box(iw * 0.9, 1.0, id * 0.7, '#e9d6c2', 0, 0.1, -id * 0.05));
      for (let i = 0; i < 4; i++) g.add(roof(iw * 0.22, 0.35, id * 0.7, '#b07850', -iw * 0.34 + i * iw * 0.225, 1.1, -id * 0.05));
      g.add(cyl(0.12, 1.6, '#8a6f5a', iw * 0.35, 1.0, -id * 0.25));
      g.add(box(iw * 0.9, 0.14, 0.06, color, 0, 0.85, id * 0.31, accent));
      break;
    }
    case 'spinning': {
      g.add(box(iw, 0.1, id, '#a3a39d'));
      g.add(box(iw * 0.95, 1.1, id * 0.75, '#c9c3d6', 0, 0.1, -id * 0.05));
      for (let i = 0; i < 5; i++) g.add(roof(iw * 0.19, 0.3, id * 0.75, '#6d6f8c', -iw * 0.38 + i * iw * 0.19, 1.2, -id * 0.05));
      g.add(cyl(0.15, 2.2, '#7a5555', -iw * 0.38, 1.2, -id * 0.32));
      g.add(box(iw * 0.95, 0.14, 0.06, color, 0, 0.9, id * 0.33, accent));
      break;
    }
    case 'sewing': {
      g.add(box(iw, 0.1, id, '#a3a39d'));
      g.add(box(iw * 0.85, 1.6, id * 0.7, '#e4e0ea', 0, 0.1, -id * 0.05));
      for (let r = 0; r < 3; r++) g.add(box(iw * 0.75, 0.16, 0.04, '#7fa8c9', 0, 0.35 + r * 0.42, id * 0.31, mat('#7fa8c9', { rough: 0.2, metal: 0.3 })));
      g.add(box(iw * 0.85, 0.1, id * 0.7, color, 0, 1.7, -id * 0.05, accent));
      break;
    }
    case 'wheatFarm':
    case 'cottonFarm': {
      const crop = type === 'wheatFarm' ? '#d8b94a' : '#f2f0e4';
      const leaf = type === 'wheatFarm' ? '#b89a32' : '#6f9a54';
      g.add(box(iw, 0.06, id, '#8c6d46'));
      for (let i = 0; i < 9; i++) g.add(box(iw * 0.62, 0.12, 0.18, i % 2 ? crop : leaf, -iw * 0.16, 0.06, -id * 0.42 + i * id * 0.105));
      g.add(box(0.9, 0.7, 1.0, '#a8402f', iw * 0.32, 0.06, id * 0.18));
      g.add(roof(0.9, 0.4, 1.0, '#5a3b2a', iw * 0.32, 0.76, id * 0.18, 0));
      g.add(cyl(0.22, 1.3, '#cfcfcf', iw * 0.32, 0.06, -id * 0.25));
      g.add(box(0.5, 0.06, 0.08, color, iw * 0.32, 0.6, id * 0.69, accent));
      break;
    }
    case 'hq': {
      g.add(box(iw, 0.12, id, '#b8b2a6'));
      g.add(box(iw * 0.7, 3.2, id * 0.7, '#9fb4c7', 0, 0.12, 0, mat('#9fb4c7', { rough: 0.2, metal: 0.4 })));
      for (let i = 0; i < 6; i++) g.add(box(iw * 0.72, 0.04, id * 0.72, '#dfe6ec', 0, 0.5 + i * 0.5, 0));
      g.add(box(iw * 0.72, 0.25, id * 0.72, color, 0, 3.3, 0, accent));
      break;
    }
  }
  return g;
}

/** 건설 중 외형: 기초, 비계 프레임, 진행률만큼 올라온 몸체, 크레인 */
export function constructionMesh(w: number, d: number, height: number, progress: number, color: string): THREE.Group {
  const g = new THREE.Group();
  const iw = w - 0.3, id = d - 0.3;
  g.add(box(iw, 0.08, id, '#9b8f7a'));
  const h = Math.max(0.1, height * progress);
  g.add(box(iw * 0.8, h, id * 0.7, '#cfc6b4', 0, 0.08, 0, mat('#cfc6b4', { opacity: 0.85 })));
  const frame = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(iw * 0.86, height, id * 0.76, 3, 3, 3)),
    new THREE.LineBasicMaterial({ color: '#e88e2a' }),
  );
  frame.position.y = height / 2 + 0.08;
  g.add(frame);
  // 크레인
  g.add(box(0.12, height + 1.2, 0.12, '#f2b21c', iw * 0.45, 0, -id * 0.45));
  g.add(box(Math.max(1.4, iw * 0.9), 0.1, 0.1, '#f2b21c', iw * 0.45 - Math.max(1.4, iw * 0.9) / 2 + 0.2, height + 1.1, -id * 0.45));
  g.add(box(0.5, 0.06, 0.08, color, 0, 0.08, id * 0.48, mat(color)));
  return g;
}

export function treeMesh(): { trunk: THREE.BufferGeometry; crown: THREE.BufferGeometry } {
  const trunk = new THREE.CylinderGeometry(0.04, 0.05, 0.3, 5).translate(0, 0.15, 0);
  const crown = new THREE.ConeGeometry(0.22, 0.6, 6).translate(0, 0.55, 0);
  return { trunk, crown };
}

export function truckGroup(color: string): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.5, 0.26, 0.24, '#f5f5f5', -0.06, 0.06, 0));
  g.add(box(0.18, 0.2, 0.22, color, 0.27, 0.06, 0));
  g.add(box(0.5, 0.05, 0.25, color, -0.06, 0.32, 0));
  return g;
}

export const SHARED = { boxGeo, cylGeo, coneGeo, prismGeo };

/** 그룹 안의 메시를 재질별로 하나로 합쳐 드로우콜을 줄임(선분 등 메시가 아닌 객체는 그대로 유지) */
export function mergeByMaterial(g: THREE.Group): THREE.Group {
  g.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const keep: THREE.Object3D[] = [];
  g.traverse((o) => {
    if (o === g) return;
    const m = o as THREE.Mesh;
    if (m.isMesh && !(m as unknown as THREE.InstancedMesh).isInstancedMesh && !Array.isArray(m.material)) {
      let geo = m.geometry.clone();
      if (geo.index) geo = geo.toNonIndexed();
      geo.deleteAttribute('uv');
      geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      const list = buckets.get(m.material) ?? [];
      list.push(geo);
      buckets.set(m.material, list);
    } else if (o.parent === g && !(o as THREE.Mesh).isMesh) keep.push(o);
  });
  const out = new THREE.Group();
  for (const [material, geos] of buckets) {
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    out.add(mesh);
  }
  for (const k of keep) out.add(k);
  return out;
}
