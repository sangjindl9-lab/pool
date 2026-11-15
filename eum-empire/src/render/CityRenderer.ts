// 3D 도시 렌더러. 경제 상태를 읽기만 하며, 장식(차량·나무·주택)은 경제 계산에 아무 영향을 주지 않습니다.
// 실제 배송 트럭은 state.shipments(출하일·도착일)에서 위치를 계산하고, 장식 차량은 실제 시간으로만 움직입니다.
import * as THREE from 'three';
import { BALANCE } from '../engine/data/balance';
import { BUILDINGS } from '../engine/data/buildings';
import { catchmentAt } from '../engine/demand';
import { checkPlacement, isRoadIndex, partyPos } from '../engine/map';
import { makeLocalRng } from '../engine/rng';
import type { Building, GameState } from '../engine/types';
import type { GameController, OverlayMode } from '../game/controller';
import { box, buildingMesh, constructionMesh, mat, mergeByMaterial, treeMesh, truckGroup } from './meshes';

const ZONE_COLORS = ['#4a4d52', '#d9d3c7', '#a9c98f', '#b9b4a6', '#c7c48a'];
const BUILD_HEIGHT: Record<string, number> = { store: 1.1, warehouse: 1.5, mill: 2.3, bakery: 1.4, spinning: 1.4, sewing: 1.8, wheatFarm: 0.8, cottonFarm: 0.8, hq: 3.4 };

interface BuildingView { group: THREE.Group; key: string; marker: THREE.Mesh }
interface Decor { tile: number; mesh: THREE.InstancedMesh; index: number; matrix: THREE.Matrix4 }

export interface HoverInfo {
  x: number;
  y: number;
  ok: boolean;
  reasons: string[];
  cost: number;
  landCost: number;
  leasePerDay: number;
  screenX: number;
  screenY: number;
}

export class CityRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private target = new THREE.Vector3(24, 0, 24);
  private yaw = Math.PI / 4;
  private pitch = 0.92;
  private dist = 46;
  private sun: THREE.DirectionalLight;
  private buildingViews = new Map<number, BuildingView>();
  private truckViews = new Map<number, THREE.Group>();
  private decor: Decor[] = [];
  private decorMeshes: THREE.InstancedMesh[] = [];
  private cars: THREE.InstancedMesh | null = null;
  private carLanes: { horizontal: boolean; line: number; dir: number; speed: number; offset: number }[] = [];
  private overlayMesh: THREE.Mesh;
  private overlayCanvas = document.createElement('canvas');
  private overlayTex: THREE.CanvasTexture;
  private overlayKey = '';
  private ghost: THREE.Mesh;
  private outline: THREE.LineSegments;
  private infoIcon: THREE.Sprite;
  private raycaster = new THREE.Raycaster();
  private ground: THREE.Mesh;
  private lastVersion = -1;
  private lastStateRef: GameState | null = null;
  private occupiedKey = '';
  private keys = new Set<string>();
  private drag: { x: number; y: number; button: number; moved: boolean; yaw: number; tx: number; tz: number } | null = null;
  private raf = 0;
  private lastT = performance.now();
  private frames = 0;
  private fpsT = performance.now();
  fps = 0;
  private extViews: THREE.Group[] = [];
  private hoverTile: { x: number; y: number } | null = null;
  private mouse = { x: 0, y: 0 };

  constructor(private container: HTMLElement, private ctrl: GameController) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = ctrl.settings.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 400);
    this.scene.background = new THREE.Color('#bcd7ea');
    this.scene.fog = new THREE.Fog('#bcd7ea', 90, 180);
    this.scene.add(new THREE.HemisphereLight('#eef6ff', '#6b6550', 1.4));
    this.sun = new THREE.DirectionalLight('#fff4e0', 2.2);
    this.sun.position.set(50, 60, 20);
    this.sun.target.position.set(24, 0, 24);
    this.sun.castShadow = ctrl.settings.shadows;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -40; sc.right = 40; sc.top = 40; sc.bottom = -40; sc.near = 10; sc.far = 160;
    this.scene.add(this.sun, this.sun.target);

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), mat('#93a77a'));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.set(24, -0.05, 24);
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.overlayCanvas.width = this.overlayCanvas.height = BALANCE.map.size;
    this.overlayTex = new THREE.CanvasTexture(this.overlayCanvas);
    this.overlayTex.magFilter = THREE.NearestFilter;
    this.overlayTex.colorSpace = THREE.SRGBColorSpace;
    this.overlayMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(BALANCE.map.size, BALANCE.map.size),
      new THREE.MeshBasicMaterial({ map: this.overlayTex, transparent: true, opacity: 0.62, depthWrite: false }),
    );
    this.overlayMesh.rotation.x = -Math.PI / 2;
    this.overlayMesh.position.set(BALANCE.map.size / 2, 0.09, BALANCE.map.size / 2);
    this.overlayMesh.visible = false;
    this.overlayMesh.renderOrder = 2;
    this.scene.add(this.overlayMesh);

    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#3ad16b', transparent: true, opacity: 0.45, depthWrite: false }));
    this.ghost.visible = false;
    this.scene.add(this.ghost);
    this.outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: '#ffd400', linewidth: 2, depthTest: false }));
    this.outline.renderOrder = 5;
    this.outline.visible = false;
    this.scene.add(this.outline);
    this.infoIcon = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTexture('i', '#ffd400', '#1d2533', 64), depthTest: false }));
    this.infoIcon.scale.set(0.8, 0.8, 1);
    this.infoIcon.renderOrder = 6;
    this.infoIcon.visible = false;
    this.scene.add(this.infoIcon);

    this.bindInput();
    this.resize();
    window.addEventListener('resize', this.resize);
    this.raf = requestAnimationFrame(this.loop);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ---------------- 정적 도시 ----------------
  private buildCity(state: GameState) {
    for (const m of this.decorMeshes) this.scene.remove(m);
    this.decorMeshes = [];
    this.decor = [];
    for (const g of this.extViews) this.scene.remove(g);
    this.extViews = [];
    const N = state.map.size;
    const rnd = makeLocalRng(state.seed ^ 0xdec0);
    const tmp = new THREE.Object3D();
    // 바닥 타일
    const tileMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.1, 1), mat('#ffffff'), N * N);
    tileMesh.receiveShadow = true;
    const col = new THREE.Color();
    for (let i = 0; i < N * N; i++) {
      const x = i % N, y = Math.floor(i / N);
      tmp.position.set(x + 0.5, 0, y + 0.5);
      tmp.updateMatrix();
      tileMesh.setMatrixAt(i, tmp.matrix);
      const code = state.map.tiles[i];
      col.set(ZONE_COLORS[code]);
      if (code !== 0) col.offsetHSL(0, 0, (rnd() - 0.5) * 0.03);
      tileMesh.setColorAt(i, col);
    }
    this.addStatic(tileMesh);
    // 차선 표시
    const dashes: THREE.Matrix4[] = [];
    for (let r = 0; r < N; r++) {
      if (!isRoadIndex(r)) continue;
      for (let t = 0; t < N; t += 1) {
        if (isRoadIndex(t)) continue;
        tmp.position.set(t + 0.5, 0.06, r + 0.5); tmp.scale.set(0.45, 1, 0.05); tmp.rotation.set(0, 0, 0); tmp.updateMatrix(); dashes.push(tmp.matrix.clone());
        tmp.position.set(r + 0.5, 0.06, t + 0.5); tmp.scale.set(0.05, 1, 0.45); tmp.updateMatrix(); dashes.push(tmp.matrix.clone());
      }
    }
    const dashMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.01, 1), mat('#f0f0e6'), dashes.length);
    dashes.forEach((m, i) => dashMesh.setMatrixAt(i, m));
    this.addStatic(dashMesh);
    // 장식: 주택·아파트·나무·주차장·공업 탱크·가로등
    const houseBody: { tile: number; m: THREE.Matrix4; color: THREE.Color }[] = [];
    const houseRoof: { tile: number; m: THREE.Matrix4 }[] = [];
    const trees: { tile: number; m: THREE.Matrix4 }[] = [];
    const stripes: { tile: number; m: THREE.Matrix4 }[] = [];
    const tanks: { tile: number; m: THREE.Matrix4 }[] = [];
    const lamps: { tile: number; m: THREE.Matrix4 }[] = [];
    const center = N / 2;
    for (let i = 0; i < N * N; i++) {
      const x = i % N, y = Math.floor(i / N);
      const code = state.map.tiles[i];
      const r = rnd();
      tmp.rotation.set(0, 0, 0); tmp.scale.set(1, 1, 1);
      if (code === 2 && r < 0.62) {
        const nearCenter = Math.abs(x - center) + Math.abs(y - center) < 22;
        const tall = nearCenter && rnd() < 0.3;
        const h = tall ? 1.4 + rnd() * 1.6 : 0.45 + rnd() * 0.25;
        const s = tall ? 0.7 : 0.55 + rnd() * 0.15;
        tmp.position.set(x + 0.5, h / 2, y + 0.5); tmp.scale.set(s, h, s); tmp.updateMatrix();
        houseBody.push({ tile: i, m: tmp.matrix.clone(), color: new THREE.Color().setHSL(0.08 + rnd() * 0.08, 0.25, tall ? 0.78 : 0.72 + rnd() * 0.1) });
        if (!tall) {
          tmp.position.set(x + 0.5, h, y + 0.5); tmp.scale.set(s * 1.1, 0.3, s * 1.05); tmp.rotation.set(0, rnd() < 0.5 ? 0 : Math.PI / 2, 0); tmp.updateMatrix();
          houseRoof.push({ tile: i, m: tmp.matrix.clone() });
        }
      } else if ((code === 2 || code === 1) && r < 0.85) {
        tmp.position.set(x + 0.2 + rnd() * 0.6, 0.05, y + 0.2 + rnd() * 0.6); const s = 0.8 + rnd() * 0.5; tmp.scale.set(s, s, s); tmp.updateMatrix();
        trees.push({ tile: i, m: tmp.matrix.clone() });
      } else if (code === 1 && r < 0.95) {
        for (let k = 0; k < 4; k++) { tmp.position.set(x + 0.2 + k * 0.2, 0.06, y + 0.5); tmp.scale.set(0.03, 1, 0.4); tmp.updateMatrix(); stripes.push({ tile: i, m: tmp.matrix.clone() }); }
      } else if (code === 3 && r < 0.25) {
        tmp.position.set(x + 0.5, 0.35, y + 0.5); tmp.scale.set(0.5, 0.7, 0.5); tmp.updateMatrix(); tanks.push({ tile: i, m: tmp.matrix.clone() });
      } else if (code === 4 && r < 0.12) {
        tmp.position.set(x + 0.5, 0.05, y + 0.5); tmp.scale.set(1, 1, 1); tmp.updateMatrix(); trees.push({ tile: i, m: tmp.matrix.clone() });
      }
      if (code === 0 && isRoadIndex(x) && isRoadIndex(y)) {
        tmp.position.set(x + 0.08, 0.5, y + 0.08); tmp.scale.set(0.05, 1, 0.05); tmp.rotation.set(0, 0, 0); tmp.updateMatrix(); lamps.push({ tile: -1, m: tmp.matrix.clone() });
      }
    }
    this.addDecor(new THREE.BoxGeometry(1, 1, 1), mat('#ffffff'), houseBody.map((h) => ({ tile: h.tile, m: h.m })), houseBody.map((h) => h.color));
    const prism = new THREE.ConeGeometry(0.72, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0);
    this.addDecor(prism, mat('#9c5a46'), houseRoof);
    const tg = treeMesh();
    this.addDecor(tg.trunk, mat('#6b4a2f'), trees);
    this.addDecor(tg.crown, mat('#3f7d3a'), trees);
    this.addDecor(new THREE.BoxGeometry(1, 0.01, 1), mat('#f5f5f5'), stripes);
    this.addDecor(new THREE.CylinderGeometry(0.5, 0.5, 1, 10), mat('#c9c9c2', { metal: 0.3, rough: 0.5 }), tanks);
    this.addDecor(new THREE.BoxGeometry(1, 1, 1), mat('#3a3f47'), lamps);
    const bulbs = lamps.map((l) => { const m = l.m.clone(); const p = new THREE.Vector3().setFromMatrixPosition(m); m.compose(p.setY(1.0), new THREE.Quaternion(), new THREE.Vector3(0.14, 0.08, 0.14)); return { tile: -1, m }; });
    this.addDecor(new THREE.BoxGeometry(1, 1, 1), mat('#fff6c8', { emissive: '#ffe9a0' }), bulbs);
    // 외부 업체 거점(지도 밖)
    for (const e of state.externals) {
      const g = new THREE.Group();
      g.add(box(2.6, 0.1, 2.6, '#8f8f8a'));
      g.add(box(1.8, 0.9, 1.4, e.role === 'seller' ? '#d6dccf' : '#e0d6c8'));
      g.add(box(1.85, 0.12, 0.08, e.role === 'seller' ? '#2e9e5b' : '#d9822b', 0, 0.7, 0.72));
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTexture(`${e.role === 'seller' ? '공급' : '매입'}·${e.name}`, '#ffffff', e.role === 'seller' ? '#2e9e5b' : '#c06b1c', 28), depthTest: false }));
      label.scale.set(4, 0.5, 1);
      label.position.y = 1.8;
      label.renderOrder = 4;
      g.add(label);
      g.position.set(e.x, 0, e.y);
      g.userData.externalId = e.id;
      this.scene.add(g);
      this.extViews.push(g);
    }
    // 지역(동) 이름
    for (const d of state.districts) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTexture(d.name, '#1d2533', 'rgba(255,255,255,0.55)', 26), depthTest: false, transparent: true }));
      s.scale.set(2.2, 0.55, 1);
      s.position.set(d.cx, 3.8, d.cy);
      s.renderOrder = 3;
      this.scene.add(s);
      this.decorMeshes.push(s as unknown as THREE.InstancedMesh);
    }
    this.setupCars(state);
  }

  private addStatic(m: THREE.Object3D) {
    this.scene.add(m);
    this.decorMeshes.push(m as THREE.InstancedMesh);
  }

  private addDecor(geo: THREE.BufferGeometry, material: THREE.Material, items: { tile: number; m: THREE.Matrix4 }[], colors?: THREE.Color[]) {
    if (!items.length) return;
    const mesh = new THREE.InstancedMesh(geo, material, items.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    items.forEach((it, i) => {
      mesh.setMatrixAt(i, it.m);
      if (colors) mesh.setColorAt(i, colors[i]);
      this.decor.push({ tile: it.tile, mesh, index: i, matrix: it.m });
    });
    this.addStatic(mesh);
  }

  /** 회사 건물이 들어선 칸의 장식은 숨김 */
  private updateDecorOcclusion(state: GameState) {
    const key = state.buildings.map((b) => `${b.id}:${b.x},${b.y}`).join('|');
    if (key === this.occupiedKey) return;
    this.occupiedKey = key;
    const N = state.map.size;
    const occ = new Uint8Array(N * N);
    for (const b of state.buildings) for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) occ[y * N + x] = 1;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const touched = new Set<THREE.InstancedMesh>();
    for (const d of this.decor) {
      if (d.tile < 0) continue;
      d.mesh.setMatrixAt(d.index, occ[d.tile] ? zero : d.matrix);
      touched.add(d.mesh);
    }
    touched.forEach((m) => (m.instanceMatrix.needsUpdate = true));
  }

  private setupCars(state: GameState) {
    if (this.cars) this.scene.remove(this.cars);
    const n = this.ctrl.settings.decorCars;
    const rnd = makeLocalRng(state.seed ^ 0xca75);
    const roads: number[] = [];
    for (let i = 0; i < state.map.size; i++) if (isRoadIndex(i)) roads.push(i);
    this.carLanes = [];
    for (let i = 0; i < n; i++) {
      this.carLanes.push({ horizontal: rnd() < 0.5, line: roads[Math.floor(rnd() * roads.length)], dir: rnd() < 0.5 ? 1 : -1, speed: 1.2 + rnd() * 1.6, offset: rnd() * 100 });
    }
    const geo = new THREE.BoxGeometry(0.34, 0.16, 0.18).translate(0, 0.14, 0);
    this.cars = new THREE.InstancedMesh(geo, mat('#ffffff', { rough: 0.4 }), Math.max(1, n));
    const palette = ['#d64541', '#2f80ed', '#f2f2f2', '#333840', '#e3a21a', '#5aa469'];
    for (let i = 0; i < n; i++) this.cars.setColorAt(i, new THREE.Color(palette[i % palette.length]));
    this.cars.count = n;
    this.cars.castShadow = true;
    this.scene.add(this.cars);
  }

  private animateCars(t: number) {
    if (!this.cars) return;
    const tmp = new THREE.Object3D();
    const L = BALANCE.map.size;
    this.carLanes.forEach((c, i) => {
      const along = (((c.offset + (t / 1000) * c.speed * c.dir) % L) + L) % L;
      const lane = c.dir > 0 ? 0.32 : 0.68;
      if (c.horizontal) { tmp.position.set(along, 0, c.line + lane); tmp.rotation.set(0, c.dir > 0 ? 0 : Math.PI, 0); }
      else { tmp.position.set(c.line + lane, 0, along); tmp.rotation.set(0, c.dir > 0 ? -Math.PI / 2 : Math.PI / 2, 0); }
      tmp.updateMatrix();
      this.cars!.setMatrixAt(i, tmp.matrix);
    });
    this.cars.instanceMatrix.needsUpdate = true;
  }

  // ---------------- 회사 건물 ----------------
  private facing(state: GameState, b: Building): number {
    const z = (x: number, y: number) => x >= 0 && y >= 0 && x < state.map.size && y < state.map.size && state.map.tiles[y * state.map.size + x] === 0;
    for (let x = b.x; x < b.x + b.w; x++) if (z(x, b.y + b.h)) return 0;
    for (let y = b.y; y < b.y + b.h; y++) if (z(b.x + b.w, y)) return Math.PI / 2;
    for (let y = b.y; y < b.y + b.h; y++) if (z(b.x - 1, y)) return -Math.PI / 2;
    return Math.PI;
  }

  private syncBuildings(state: GameState) {
    const seen = new Set<number>();
    for (const b of state.buildings) {
      seen.add(b.id);
      const owner = state.companies.find((c) => c.id === b.owner)!;
      const total = Math.max(1, b.completeDay - b.startDay);
      const progress = b.status === 'active' ? 1 : Math.min(1, (state.day - b.startDay) / total);
      const key = `${b.type}|${b.status}|${Math.round(progress * 10)}|${owner.color}|${owner.bankrupt}`;
      let v = this.buildingViews.get(b.id);
      if (v && v.key === key) continue;
      if (v) this.scene.remove(v.group);
      const inner = mergeByMaterial(b.status === 'active' ? buildingMesh(b.type, b.w, b.h, owner.color) : constructionMesh(b.w, b.h, BUILD_HEIGHT[b.type], progress, owner.color));
      const group = new THREE.Group();
      inner.rotation.y = this.facing(state, b);
      group.add(inner);
      group.position.set(b.x + b.w / 2, 0.05, b.y + b.h / 2);
      const marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), mat(owner.color, { emissive: owner.color, rough: 0.4 }));
      marker.position.y = BUILD_HEIGHT[b.type] + 0.7;
      marker.userData.baseY = marker.position.y;
      group.add(marker);
      group.traverse((o) => (o.userData.buildingId = b.id));
      this.scene.add(group);
      v = { group, key, marker };
      this.buildingViews.set(b.id, v);
    }
    for (const [id, v] of this.buildingViews) {
      if (!seen.has(id)) { this.scene.remove(v.group); this.buildingViews.delete(id); }
    }
  }

  // ---------------- 실제 배송 트럭 ----------------
  private roadLine(v: number): number {
    const step = BALANCE.map.roadEvery;
    const max = Math.floor((BALANCE.map.size - 2) / step) * step;
    return Math.min(max, Math.max(0, Math.round(v / step) * step)) + 0.5;
  }

  private truckPath(a: { x: number; y: number }, b: { x: number; y: number }): THREE.Vector3[] {
    const rA = this.roadLine(a.y), cB = this.roadLine(b.x), rB = this.roadLine(b.y);
    const pts = [[a.x, a.y], [a.x, rA], [cB, rA], [cB, rB], [b.x, rB], [b.x, b.y]];
    return pts.map(([x, z]) => new THREE.Vector3(x, 0.05, z));
  }

  private syncTrucks(state: GameState) {
    const seen = new Set<number>();
    const now = state.day + this.ctrl.clock.fraction;
    for (const sh of state.shipments) {
      seen.add(sh.id);
      let g = this.truckViews.get(sh.id);
      if (!g) {
        const color = state.companies.find((c) => c.id === sh.holder)?.color ?? '#888';
        g = truckGroup(color);
        const a = partyPos(state, sh.from), b = partyPos(state, sh.to);
        g.userData.path = a && b ? this.truckPath(a, b) : [];
        this.scene.add(g);
        this.truckViews.set(sh.id, g);
      }
      const path: THREE.Vector3[] = g.userData.path;
      if (path.length < 2) continue;
      const t = Math.min(1, Math.max(0, (now - sh.shipDay) / Math.max(1, sh.arriveDay - sh.shipDay)));
      const lens = path.slice(1).map((p, i) => p.distanceTo(path[i]));
      const total = lens.reduce((s, l) => s + l, 0) || 1;
      let d = t * total, i = 0;
      while (i < lens.length - 1 && d > lens[i]) { d -= lens[i]; i++; }
      const p0 = path[i], p1 = path[i + 1];
      const f = lens[i] > 0 ? d / lens[i] : 0;
      g.position.lerpVectors(p0, p1, f);
      const dx = p1.x - p0.x, dz = p1.z - p0.z;
      if (dx || dz) g.rotation.y = Math.atan2(-dz, dx);
    }
    for (const [id, g] of this.truckViews) if (!seen.has(id)) { this.scene.remove(g); this.truckViews.delete(id); }
  }

  // ---------------- 오버레이 ----------------
  private updateOverlay(state: GameState, mode: OverlayMode) {
    const key = `${mode}|${mode === 'logistics' ? state.buildings.length : ''}|${state.seed}`;
    this.overlayMesh.visible = mode !== 'none';
    if (mode === 'none' || key === this.overlayKey) return;
    this.overlayKey = key;
    const N = state.map.size;
    const vals = new Float32Array(N * N);
    const sellers = state.externals.filter((e) => e.role === 'seller');
    const hubs = state.buildings.filter((b) => b.owner === 'player' && (b.type === 'warehouse' || BUILDINGS[b.type].recipe));
    for (let i = 0; i < N * N; i++) {
      const x = i % N + 0.5, y = Math.floor(i / N) + 0.5;
      if (mode === 'demand:bread') vals[i] = catchmentAt(state, 'bread', x, y);
      else if (mode === 'demand:clothing') vals[i] = catchmentAt(state, 'clothing', x, y);
      else if (mode === 'land') vals[i] = state.map.landPrice[i];
      else if (mode === 'zones') vals[i] = state.map.tiles[i];
      else if (mode === 'logistics') {
        let best = Infinity;
        for (const e of sellers) best = Math.min(best, Math.abs(e.x - x) + Math.abs(e.y - y));
        for (const h of hubs) best = Math.min(best, Math.abs(h.x + h.w / 2 - x) + Math.abs(h.y + h.h / 2 - y));
        vals[i] = -best; // 가까울수록 높음
      }
    }
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < vals.length; i++) if (state.map.tiles[i] !== 0) { min = Math.min(min, vals[i]); max = Math.max(max, vals[i]); }
    const ctx = this.overlayCanvas.getContext('2d')!;
    const img = ctx.createImageData(N, N);
    for (let i = 0; i < N * N; i++) {
      let c: [number, number, number];
      if (state.map.tiles[i] === 0) { img.data[i * 4 + 3] = 0; continue; }
      if (mode === 'zones') c = hexRgb(['#000', '#f2994a', '#27ae60', '#828282', '#e2c044'][state.map.tiles[i]]);
      else c = heat((vals[i] - min) / Math.max(1e-9, max - min));
      img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    this.overlayTex.needsUpdate = true;
  }

  // ---------------- 입력·카메라 ----------------
  private onKeyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
    this.keys.add(e.key.toLowerCase());
    if (e.key === 'Escape') { this.ctrl.setBuildMode(null); this.ctrl.select(null); }
  };
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());

  private bindInput() {
    const el = this.renderer.domElement;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      this.drag = { x: e.clientX, y: e.clientY, button: e.button, moved: false, yaw: this.yaw, tx: this.target.x, tz: this.target.z };
    });
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      this.mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) this.drag.moved = true;
      if (!this.drag.moved) return;
      if (this.drag.button === 2) {
        this.yaw = this.drag.yaw - dx * 0.006;
      } else {
        const s = this.dist / 700;
        const fx = Math.cos(this.yaw), fz = -Math.sin(this.yaw);
        const rx = Math.sin(this.yaw), rz = Math.cos(this.yaw);
        this.target.x = this.drag.tx - dx * s * fx - dy * s * rx;
        this.target.z = this.drag.tz - dx * s * fz - dy * s * rz;
        this.clampTarget();
      }
    });
    el.addEventListener('pointerup', (e) => {
      const d = this.drag;
      this.drag = null;
      if (!d || d.moved || d.button !== 0) return;
      this.click(e);
    });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.dist = Math.min(90, Math.max(7, this.dist * (1 + Math.sign(e.deltaY) * 0.1)));
    }, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  private clampTarget() {
    this.target.x = Math.max(-8, Math.min(56, this.target.x));
    this.target.z = Math.max(-8, Math.min(56, this.target.z));
  }

  private ndc(px: number, py: number) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2((px / r.width) * 2 - 1, -(py / r.height) * 2 + 1);
  }

  private groundTile(px: number, py: number): { x: number; y: number } | null {
    this.raycaster.setFromCamera(this.ndc(px, py), this.camera);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p)) return null;
    return { x: Math.floor(p.x), y: Math.floor(p.z) };
  }

  private footprintAt(tile: { x: number; y: number }) {
    const m = this.ctrl.buildMode!;
    const def = BUILDINGS[m.type];
    return { x: tile.x - Math.floor((def.w - 1) / 2), y: tile.y - Math.floor((def.h - 1) / 2), w: def.w, h: def.h };
  }

  private click(e: PointerEvent) {
    const state = this.ctrl.state;
    if (!state) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    if (this.ctrl.buildMode) {
      const t = this.groundTile(px, py);
      if (!t) return;
      const fp = this.footprintAt(t);
      const res = this.ctrl.command({ type: 'build', building: this.ctrl.buildMode.type, x: fp.x, y: fp.y, tenure: this.ctrl.buildMode.tenure }, `${BUILDINGS[this.ctrl.buildMode.type].name} 건설을 시작했습니다`);
      if (res.ok) { this.ctrl.setBuildMode(null); this.ctrl.select(res.id ?? null); }
      return;
    }
    this.raycaster.setFromCamera(this.ndc(px, py), this.camera);
    const objs: THREE.Object3D[] = [...[...this.buildingViews.values()].map((v) => v.group), ...this.extViews];
    const hit = this.raycaster.intersectObjects(objs, true).find((h) => h.object.userData.buildingId !== undefined || findExt(h.object) !== undefined);
    if (hit) {
      if (hit.object.userData.buildingId !== undefined) this.ctrl.select(hit.object.userData.buildingId);
      else this.ctrl.selectExternal(findExt(hit.object)!);
    } else this.ctrl.select(null);
  }

  focusOn(x: number, y: number) {
    this.target.set(x, 0, y);
    this.dist = Math.min(this.dist, 28);
  }

  private resize = () => {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  };

  private updateCamera(dt: number) {
    const k = this.keys;
    const speed = (this.dist / 18) * dt * 0.012;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    if (k.has('w') || k.has('arrowup')) { this.target.x += fx * speed; this.target.z += fz * speed; }
    if (k.has('s') || k.has('arrowdown')) { this.target.x -= fx * speed; this.target.z -= fz * speed; }
    if (k.has('a') || k.has('arrowleft')) { this.target.x -= rx * speed; this.target.z -= rz * speed; }
    if (k.has('d') || k.has('arrowright')) { this.target.x += rx * speed; this.target.z += rz * speed; }
    if (k.has('q')) this.yaw += dt * 0.0018;
    if (k.has('e')) this.yaw -= dt * 0.0018;
    if (k.has('=') || k.has('+')) this.dist = Math.max(7, this.dist - dt * 0.03);
    if (k.has('-')) this.dist = Math.min(90, this.dist + dt * 0.03);
    this.clampTarget();
    const cp = Math.cos(this.pitch);
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * cp * this.dist,
      Math.sin(this.pitch) * this.dist,
      this.target.z + Math.cos(this.yaw) * cp * this.dist,
    );
    this.camera.lookAt(this.target);
  }

  // ---------------- 프레임 ----------------
  private loop = (t: number) => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(100, t - this.lastT);
    this.lastT = t;
    this.ctrl.frame(dt);
    const state = this.ctrl.state;
    if (!state) return;
    if (state !== this.lastStateRef) {
      this.lastStateRef = state;
      for (const v of this.buildingViews.values()) this.scene.remove(v.group);
      this.buildingViews.clear();
      for (const g of this.truckViews.values()) this.scene.remove(g);
      this.truckViews.clear();
      this.occupiedKey = '';
      this.overlayKey = '';
      this.buildCity(state);
      const hq = state.buildings.find((b) => b.owner === 'player' && b.type === 'hq');
      if (hq) this.focusOn(hq.x + 1, hq.y + 1);
    }
    if (this.renderer.shadowMap.enabled !== this.ctrl.settings.shadows) {
      this.renderer.shadowMap.enabled = this.ctrl.settings.shadows;
      this.sun.castShadow = this.ctrl.settings.shadows;
      this.scene.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m) m.needsUpdate = true; });
    }
    if (this.cars && this.cars.count !== this.ctrl.settings.decorCars) this.setupCars(state);
    if (this.ctrl.focusRequest !== null) {
      const b = state.buildings.find((q) => q.id === this.ctrl.focusRequest);
      if (b) this.focusOn(b.x + b.w / 2, b.y + b.h / 2);
      this.ctrl.focusRequest = null;
    }
    if (this.ctrl.version !== this.lastVersion) {
      this.lastVersion = this.ctrl.version;
      this.syncBuildings(state);
      this.updateDecorOcclusion(state);
      this.updateOverlay(state, this.ctrl.overlay);
    }
    this.syncTrucks(state);
    this.animateCars(t);
    this.updateSelection(state, t);
    this.updateGhost(state);
    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
    this.ctrl.drawCalls = this.renderer.info.render.calls;
    this.frames++;
    if (t - this.fpsT > 1000) { this.fps = (this.frames * 1000) / (t - this.fpsT); this.frames = 0; this.fpsT = t; this.ctrl.fps = this.fps; }
  };

  private updateSelection(state: GameState, t: number) {
    for (const [id, v] of this.buildingViews) v.marker.position.y = v.marker.userData.baseY + Math.sin(t / 500 + id) * 0.08;
    const b = this.ctrl.selected !== null ? state.buildings.find((q) => q.id === this.ctrl.selected) : undefined;
    if (!b) { this.outline.visible = false; this.infoIcon.visible = false; return; }
    const h = BUILD_HEIGHT[b.type];
    this.outline.visible = true;
    this.outline.scale.set(b.w - 0.1, h + 0.2, b.h - 0.1);
    this.outline.position.set(b.x + b.w / 2, (h + 0.2) / 2, b.y + b.h / 2);
    this.infoIcon.visible = true;
    this.infoIcon.position.set(b.x + b.w / 2, h + 1.5 + Math.sin(t / 300) * 0.12, b.y + b.h / 2);
  }

  private updateGhost(state: GameState) {
    const m = this.ctrl.buildMode;
    if (!m) { this.ghost.visible = false; if (this.ctrl.hover) { this.ctrl.hover = null; this.ctrl.notify(); } return; }
    const tile = this.groundTile(this.mouse.x, this.mouse.y);
    if (!tile) { this.ghost.visible = false; return; }
    const fp = this.footprintAt(tile);
    const same = this.hoverTile && this.hoverTile.x === fp.x && this.hoverTile.y === fp.y && this.ctrl.hover;
    const chk = checkPlacement(state, m.type, fp.x, fp.y, m.tenure);
    const owner = state.companies[0];
    const affordable = owner.ledger.cash >= chk.constructionCost;
    const ok = chk.ok && affordable;
    this.ghost.visible = true;
    const h = BUILD_HEIGHT[m.type];
    this.ghost.scale.set(fp.w - 0.15, h, fp.h - 0.15);
    this.ghost.position.set(fp.x + fp.w / 2, h / 2 + 0.05, fp.y + fp.h / 2);
    (this.ghost.material as THREE.MeshBasicMaterial).color.set(ok ? '#3ad16b' : '#e74c3c');
    if (!same || this.ctrl.hover?.screenX !== this.mouse.x) {
      this.hoverTile = fp;
      this.ctrl.hover = {
        x: fp.x, y: fp.y, ok,
        reasons: affordable ? chk.reasons : [...chk.reasons, '현금이 부족합니다'],
        cost: chk.constructionCost, landCost: chk.landCost, leasePerDay: chk.leasePerDay,
        screenX: this.mouse.x, screenY: this.mouse.y,
      };
      this.ctrl.notify();
    }
  }
}

function findExt(o: THREE.Object3D | null): number | undefined {
  while (o) { if (o.userData.externalId !== undefined) return o.userData.externalId; o = o.parent; }
  return undefined;
}

function textTexture(text: string, fg: string, bg: string, size: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  ctx.font = `bold ${size}px "Noto Sans KR", "Malgun Gothic", sans-serif`;
  const w = Math.max(size, Math.ceil(ctx.measureText(text).width + size * 0.8));
  c.width = w; c.height = Math.ceil(size * 1.5);
  ctx.font = `bold ${size}px "Noto Sans KR", "Malgun Gothic", sans-serif`;
  ctx.fillStyle = bg;
  const r = c.height / 2.5;
  ctx.beginPath(); ctx.roundRect(0, 0, c.width, c.height, r); ctx.fill();
  ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, c.width / 2, c.height / 2 + 1);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function hexRgb(h: string): [number, number, number] {
  const c = new THREE.Color(h);
  return [c.r * 255, c.g * 255, c.b * 255];
}
function heat(v: number): [number, number, number] {
  const stops: [number, number, number][] = [[49, 54, 149], [69, 160, 220], [120, 200, 120], [250, 220, 80], [215, 48, 39]];
  const x = Math.min(0.9999, Math.max(0, v)) * (stops.length - 1);
  const i = Math.floor(x), f = x - i;
  const a = stops[i], b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
