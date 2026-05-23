import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useGame } from "./store";
import { WORLD } from "./store";

function makeBallTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#d56a21";
  ctx.fillRect(0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const n = Math.random() * 16 - 8;
      img.data[i] = Math.min(255, img.data[i] + n);
      img.data[i + 1] = Math.min(255, img.data[i + 1] + n * 0.7);
      img.data[i + 2] = Math.min(255, img.data[i + 2] + n * 0.4);
    }
  }
  ctx.putImageData(img, 0, 0);
  ctx.strokeStyle = "#3a1a08";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, size / 2);
  ctx.lineTo(size, size / 2);
  ctx.moveTo(size / 4, 0);
  ctx.lineTo(size / 4, size);
  ctx.moveTo((3 * size) / 4, 0);
  ctx.lineTo((3 * size) / 4, size);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(size / 4, size / 2, size * 0.18, size * 0.18, 0, 0, Math.PI * 2);
  ctx.ellipse((3 * size) / 4, size / 2, size * 0.18, size * 0.18, 0, 0, Math.PI * 2);
  ctx.stroke();
  const t = new THREE.CanvasTexture(canvas);
  t.anisotropy = 8;
  return t;
}

export function Ball() {
  const ref = useRef<THREE.Mesh>(null);
  const tex = useMemo(() => makeBallTexture(), []);
  useFrame((_, dt) => {
    const b = useGame.getState().ball;
    if (!ref.current) return;
    ref.current.position.set(b.pos[0], b.pos[1], b.pos[2]);
    if (b.holderId === null) {
      const speed = Math.hypot(b.vel[0], b.vel[2]);
      if (speed > 0.05) {
        const axis = new THREE.Vector3(-b.vel[2], 0, b.vel[0]).normalize();
        ref.current.rotateOnWorldAxis(axis, speed * dt * 4);
      }
    }
    b.ref = ref.current;
  });
  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[WORLD.ballR, 24, 18]} />
      <meshStandardMaterial map={tex} roughness={0.6} />
    </mesh>
  );
}
