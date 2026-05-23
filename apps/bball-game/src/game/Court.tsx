import React, { useMemo } from "react";
import * as THREE from "three";
import { COURT } from "./types";

function woodTexture(): THREE.Texture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const grain = 0.5 + 0.5 * Math.sin(x * 0.05 + Math.sin(y * 0.6) * 1.4);
      const noise = (Math.random() - 0.5) * 30;
      img.data[i] = Math.min(255, 130 + grain * 60 + noise);
      img.data[i + 1] = Math.min(255, 80 + grain * 40 + noise * 0.5);
      img.data[i + 2] = Math.min(255, 45 + grain * 25 + noise * 0.3);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 14);
  tex.anisotropy = 8;
  return tex;
}

function Line({ a, b, w = 0.05, color = "#fff" }: { a: [number, number]; b: [number, number]; w?: number; color?: string }) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  const ang = Math.atan2(dx, dz);
  return (
    <mesh position={[(a[0] + b[0]) / 2, 0.01, (a[1] + b[1]) / 2]} rotation={[0, ang, 0]}>
      <boxGeometry args={[w, 0.005, len]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
}

function CourtLines() {
  const W = COURT.width;
  const L = COURT.length;
  const arcSeg = 48;
  const arcs: React.ReactElement[] = [];
  for (let side = -1; side <= 1; side += 2) {
    const cz = side * (L / 2 - 1.575);
    for (let i = 0; i < arcSeg; i++) {
      const a1 = Math.PI + (i / arcSeg) * Math.PI;
      const a2 = Math.PI + ((i + 1) / arcSeg) * Math.PI;
      const r = 6.75;
      const p1: [number, number] = [Math.cos(a1) * r, cz - Math.sin(a1) * r * side];
      const p2: [number, number] = [Math.cos(a2) * r, cz - Math.sin(a2) * r * side];
      arcs.push(<Line key={`arc-${side}-${i}`} a={p1} b={p2} />);
    }
  }
  const circle: React.ReactElement[] = [];
  for (let i = 0; i < 64; i++) {
    const a1 = (i / 64) * Math.PI * 2;
    const a2 = ((i + 1) / 64) * Math.PI * 2;
    const r = 1.8;
    circle.push(
      <Line key={`mc-${i}`} a={[Math.cos(a1) * r, Math.sin(a1) * r]} b={[Math.cos(a2) * r, Math.sin(a2) * r]} />,
    );
  }
  return (
    <group>
      <Line a={[-W / 2, 0]} b={[W / 2, 0]} />
      <Line a={[-W / 2, -L / 2]} b={[W / 2, -L / 2]} />
      <Line a={[-W / 2, L / 2]} b={[W / 2, L / 2]} />
      <Line a={[-W / 2, -L / 2]} b={[-W / 2, L / 2]} />
      <Line a={[W / 2, -L / 2]} b={[W / 2, L / 2]} />
      {[-1, 1].map((side) => {
        const baseZ = side * (L / 2);
        const keyD = 5.8;
        const keyW = 4.9;
        const innerZ = baseZ - side * keyD;
        return (
          <group key={`key-${side}`}>
            <Line a={[-keyW / 2, baseZ]} b={[-keyW / 2, innerZ]} />
            <Line a={[keyW / 2, baseZ]} b={[keyW / 2, innerZ]} />
            <Line a={[-keyW / 2, innerZ]} b={[keyW / 2, innerZ]} />
          </group>
        );
      })}
      {arcs}
      {circle}
    </group>
  );
}

function Hoop({ z, flip }: { z: number; flip: boolean }) {
  const Y = COURT.hoopY;
  const offset = flip ? -0.3 : 0.3;
  const rimZ = z + offset;
  const boardZ = z;
  const segs = 24;
  const rimSegments: React.ReactElement[] = [];
  for (let i = 0; i < segs; i++) {
    const a1 = (i / segs) * Math.PI * 2;
    const a2 = ((i + 1) / segs) * Math.PI * 2;
    const p1 = new THREE.Vector3(Math.cos(a1) * COURT.rimR, 0, Math.sin(a1) * COURT.rimR);
    const p2 = new THREE.Vector3(Math.cos(a2) * COURT.rimR, 0, Math.sin(a2) * COURT.rimR);
    const mid = p1.clone().add(p2).multiplyScalar(0.5);
    const len = p1.distanceTo(p2);
    const ang = Math.atan2(p2.x - p1.x, p2.z - p1.z);
    rimSegments.push(
      <mesh key={i} position={[mid.x, 0, mid.z]} rotation={[0, ang, 0]}>
        <boxGeometry args={[0.02, 0.02, len]} />
        <meshStandardMaterial color="#e55600" metalness={0.5} roughness={0.4} />
      </mesh>,
    );
  }
  const netLines: React.ReactElement[] = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const top = new THREE.Vector3(Math.cos(a) * COURT.rimR, 0, Math.sin(a) * COURT.rimR);
    const bot = new THREE.Vector3(Math.cos(a) * COURT.rimR * 0.55, -0.4, Math.sin(a) * COURT.rimR * 0.55);
    const mid = top.clone().add(bot).multiplyScalar(0.5);
    const dir = bot.clone().sub(top);
    const len = dir.length();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize());
    netLines.push(
      <mesh key={`n${i}`} position={[mid.x, mid.y, mid.z]} quaternion={q}>
        <boxGeometry args={[0.008, 0.008, len]} />
        <meshStandardMaterial color="#f8f8f8" transparent opacity={0.85} />
      </mesh>,
    );
  }
  return (
    <group>
      <mesh position={[0, 1.6, boardZ + (flip ? 0.6 : -0.6)]}>
        <cylinderGeometry args={[0.08, 0.08, 3.2, 12]} />
        <meshStandardMaterial color="#1a1a1a" metalness={0.7} roughness={0.4} />
      </mesh>
      <mesh position={[0, Y + 0.05, boardZ + (flip ? 0.3 : -0.3)]}>
        <boxGeometry args={[0.08, 0.08, 0.6]} />
        <meshStandardMaterial color="#1a1a1a" metalness={0.7} roughness={0.4} />
      </mesh>
      <mesh position={[0, Y + 0.15, boardZ]}>
        <boxGeometry args={[1.8, 1.05, 0.04]} />
        <meshStandardMaterial color="#ffffff" transparent opacity={0.9} roughness={0.1} metalness={0.05} />
      </mesh>
      <mesh position={[0, Y + 0.06, boardZ + (flip ? -0.024 : 0.024)]}>
        <boxGeometry args={[0.59, 0.45, 0.005]} />
        <meshStandardMaterial color="#c92a2a" />
      </mesh>
      <mesh position={[0, Y + 0.06, boardZ + (flip ? -0.025 : 0.025)]}>
        <boxGeometry args={[0.55, 0.41, 0.005]} />
        <meshStandardMaterial color="#fff" />
      </mesh>
      <group position={[0, Y, rimZ]}>{rimSegments}</group>
      <group position={[0, Y - 0.2, rimZ]}>{netLines}</group>
    </group>
  );
}

export function Court() {
  const tex = useMemo(() => woodTexture(), []);
  return (
    <group>
      <mesh position={[0, -0.31, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[160, 160]} />
        <meshStandardMaterial color="#0c0d11" />
      </mesh>
      <mesh position={[0, -0.05, 0]} receiveShadow>
        <boxGeometry args={[COURT.width + 4, 0.1, COURT.length + 4]} />
        <meshStandardMaterial map={tex} />
      </mesh>
      <CourtLines />
      <Hoop z={COURT.length / 2 - 1.2} flip={true} />
      <Hoop z={-COURT.length / 2 + 1.2} flip={false} />
    </group>
  );
}
