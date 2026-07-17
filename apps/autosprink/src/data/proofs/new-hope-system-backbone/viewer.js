import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { proofPromise } from './proof.js';

const result = await proofPromise;
const canvas = document.querySelector('#model-canvas');
const status = document.querySelector('#model-status');
const page = result.sourceBindings.approvedPlan.pageBoxPdfPt;
const pdfPtPerFt = 9;
const widthFt = page.width / pdfPtPerFt;
const depthFt = page.height / pdfPtPerFt;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x06111c);
scene.fog = new THREE.Fog(0x06111c, 290, 510);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;

const camera = new THREE.PerspectiveCamera(39, 1, 0.1, 900);
camera.position.set(245, 205, 310);
const controls = new OrbitControls(camera, canvas);
controls.target.set(125, 7, 128);
controls.enableDamping = true;
controls.dampingFactor = 0.055;
controls.minDistance = 80;
controls.maxDistance = 560;

scene.add(new THREE.HemisphereLight(0xe6f9ff, 0x101923, 2.4));
const key = new THREE.DirectionalLight(0xffffff, 3.5);
key.position.set(90, 240, -80);
scene.add(key);
const rim = new THREE.DirectionalLight(0x22d3ee, 2.5);
rim.position.set(-120, 80, 220);
scene.add(rim);

const texture = await new THREE.TextureLoader().loadAsync('../new-hope-truss-clearance/approved-fp20-full-underlay.png');
texture.colorSpace = THREE.SRGBColorSpace;
texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
const underlay = new THREE.Mesh(
  new THREE.PlaneGeometry(widthFt, depthFt),
  new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.88, side: THREE.DoubleSide }),
);
underlay.rotation.x = -Math.PI / 2;
underlay.position.set(widthFt / 2, 0, depthFt / 2);
scene.add(underlay);

const grid = new THREE.GridHelper(Math.max(widthFt, depthFt), 24, 0x4de7ff, 0x17334b);
grid.position.set(widthFt / 2, 0.06, depthFt / 2);
scene.add(grid);

function planPosition(pdfPt, elevationFt = 0.35) {
  return new THREE.Vector3(pdfPt.x / pdfPtPerFt, elevationFt, pdfPt.y / pdfPtPerFt);
}

function ringAt(pdfPt, color, radius = 2.4) {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 0.45, 12, 34),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.1 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.copy(planPosition(pdfPt));
  scene.add(ring);
}

for (const component of result.plan2d.components) {
  if (component.kind === 'low-point-tie-in') ringAt(component.pdfPt, 0x34d399, 2.1);
  if (component.kind === 'field-route-drum-drip-intent') ringAt(component.pdfPt, 0xfb7185, 3.1);
  if (component.kind === 'inspectors-test') ringAt(component.pdfPt, 0x60a5fa, 2.5);
}

for (const point of result.model3d.sourceIntersectionPoints) {
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(1.45, 28, 18),
    new THREE.MeshStandardMaterial({ color: 0x4de7ff, emissive: 0x0e7490, emissiveIntensity: 1.8, metalness: 0.35, roughness: 0.25 }),
  );
  marker.position.copy(planPosition(point.pdfPt, point.localElevationFt));
  scene.add(marker);
  const datum = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([planPosition(point.pdfPt, 0.4), planPosition(point.pdfPt, point.localElevationFt)]),
    new THREE.LineDashedMaterial({ color: 0xfbbf24, dashSize: 1.2, gapSize: 0.7 }),
  );
  datum.computeLineDistances();
  scene.add(datum);
}

const sourceLeg = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints(result.model3d.sourceIntersectionPoints.map((point) => planPosition(point.pdfPt, point.localElevationFt))),
  new THREE.LineDashedMaterial({ color: 0xfb7185, dashSize: 0.8, gapSize: 1.1, transparent: true, opacity: 0.6 }),
);
sourceLeg.computeLineDistances();
sourceLeg.visible = false;
scene.add(sourceLeg);

function resize() {
  const width = Math.max(canvas.clientWidth, 320);
  const height = Math.max(canvas.clientHeight, 520);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas);
resize();
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

canvas.dataset.ready = 'true';
canvas.dataset.releasedRouteCount = String(result.model3d.releasedRoutes.length);
status.textContent = `${result.model3d.sourceIntersectionPoints.length} exact source-intersection points - 0 released installation routes - drag to orbit`;
window.__NEW_HOPE_SYSTEM_BACKBONE_3D__ = { result, scene, camera, renderer };
