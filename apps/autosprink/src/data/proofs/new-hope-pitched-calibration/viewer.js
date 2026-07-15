import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const canvas = document.querySelector('#model-canvas');
const status = document.querySelector('#model-status');
const model = await fetch('./model.json').then((response) => {
  if (!response.ok) throw new Error(`model.json ${response.status}`);
  return response.json();
});

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07111d);
scene.fog = new THREE.Fog(0x07111d, 110, 185);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 500);
camera.position.set(73, 62, 91);
camera.lookAt(21.5, 10, 30.375);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(21.5, 10, 30.375);
controls.enableDamping = true;
controls.dampingFactor = 0.055;
controls.minDistance = 48;
controls.maxDistance = 180;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.32;

scene.add(new THREE.HemisphereLight(0xd8f7ff, 0x12202d, 2.2));
const key = new THREE.DirectionalLight(0xffffff, 3.2);
key.position.set(35, 90, -30);
scene.add(key);
const rim = new THREE.DirectionalLight(0x22d3ee, 2.4);
rim.position.set(-55, 25, 95);
scene.add(rim);

const root = new THREE.Group();
scene.add(root);

const texture = await new THREE.TextureLoader().loadAsync(model.underlay.image);
texture.colorSpace = THREE.SRGBColorSpace;
texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
const underlay = new THREE.Mesh(
  new THREE.PlaneGeometry(model.roof.widthFt, model.roof.depthFt),
  new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
);
underlay.rotation.x = -Math.PI / 2;
underlay.position.set(model.roof.widthFt / 2, 0, model.roof.depthFt / 2);
root.add(underlay);

const footprint = new THREE.Mesh(
  new THREE.BoxGeometry(model.roof.widthFt, model.roof.eaveZFt, model.roof.depthFt),
  new THREE.MeshPhysicalMaterial({ color: 0x0f2637, transparent: true, opacity: 0.18, roughness: 0.18, metalness: 0.05, transmission: 0.3, depthWrite: false })
);
footprint.position.set(model.roof.widthFt / 2, model.roof.eaveZFt / 2, model.roof.depthFt / 2);
root.add(footprint);

function roofPlane(vertices, color) {
  const positions = [];
  const indices = [0, 1, 2, 0, 2, 3];
  for (const [x, y, z] of vertices) positions.push(x, z, y);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshPhysicalMaterial({ color, transparent: true, opacity: 0.3, roughness: 0.24, metalness: 0.08, transmission: 0.16, depthWrite: false, side: THREE.DoubleSide }));
  root.add(mesh);
  root.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: 0x67e8f9 })));
}

roofPlane(model.roof.planes[0].verticesFt, 0x0e7490);
roofPlane(model.roof.planes[1].verticesFt, 0x155e75);

const ridgeGeometry = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(model.branchline.startFt.x, model.branchline.visualizationZFt, model.branchline.startFt.y),
  new THREE.Vector3(model.branchline.endFt.x, model.branchline.visualizationZFt, model.branchline.endFt.y)
]);
root.add(new THREE.Line(ridgeGeometry, new THREE.LineBasicMaterial({ color: 0xfbbf24 })));

for (const head of model.heads) {
  const height = head.permittedZFt.max - head.permittedZFt.min;
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.22, height, 18),
    new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0x7c4a03, emissiveIntensity: 1.2 })
  );
  band.position.set(head.xFt, head.permittedZFt.min + height / 2, head.yFt);
  root.add(band);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.68, 0.13, 12, 30),
    new THREE.MeshStandardMaterial({ color: 0x67e8f9, emissive: 0x0891b2, emissiveIntensity: 1.6 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.set(head.xFt, model.branchline.visualizationZFt, head.yFt);
  root.add(ring);
}

const grid = new THREE.GridHelper(72, 12, 0x315474, 0x17334b);
grid.position.set(model.roof.widthFt / 2, -0.08, model.roof.depthFt / 2);
root.add(grid);

function resize() {
  const width = Math.max(canvas.clientWidth, 320);
  const height = Math.max(canvas.clientHeight, 420);
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
status.textContent = 'Interactive model ready - drag to orbit, wheel to zoom';
window.__NEW_HOPE_PITCHED_CALIBRATION_PROOF__ = { model, scene, camera, renderer };
