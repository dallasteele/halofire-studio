import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { PlayerState, TeamId } from "./types";
import { useGame } from "./store";

const COLORS: Record<TeamId, [string, string]> = {
  home: ["#d53636", "#7a1f1f"],
  away: ["#3057d5", "#1f3a7a"],
};

const SKINS = ["#f1c27d", "#c68642", "#8d5524", "#e0ac69", "#a16a3f"];

export function Player({ playerId }: { playerId: number }) {
  const ref = useRef<THREE.Group>(null);
  const jersey = COLORS[playerId < 5 ? "home" : "away"][0];
  const trim = COLORS[playerId < 5 ? "home" : "away"][1];
  const skin = SKINS[playerId % SKINS.length];
  const controlled = useGame((s) => s.controlledId === playerId);

  useFrame(() => {
    const p = useGame.getState().players[playerId];
    if (!ref.current || !p) return;
    ref.current.position.set(p.pos[0], p.pos[1], p.pos[2]);
    ref.current.rotation.y = p.facing;
    p.ref = ref.current;
  });

  return (
    <group ref={ref}>
      <mesh position={[0, 0.95, 0]} castShadow>
        <capsuleGeometry args={[0.3, 0.45, 4, 8]} />
        <meshStandardMaterial color={jersey} />
      </mesh>
      <mesh position={[0, 0.5, 0]} castShadow>
        <boxGeometry args={[0.58, 0.35, 0.5]} />
        <meshStandardMaterial color={trim} />
      </mesh>
      <mesh position={[0, 1.65, 0]} castShadow>
        <sphereGeometry args={[0.16, 16, 12]} />
        <meshStandardMaterial color={skin} />
      </mesh>
      <mesh position={[-0.32, 0.95, 0]} castShadow>
        <boxGeometry args={[0.13, 0.55, 0.13]} />
        <meshStandardMaterial color={skin} />
      </mesh>
      <mesh position={[0.32, 0.95, 0]} castShadow>
        <boxGeometry args={[0.13, 0.55, 0.13]} />
        <meshStandardMaterial color={skin} />
      </mesh>
      <mesh position={[-0.14, 0.18, 0]} castShadow>
        <boxGeometry args={[0.18, 0.4, 0.2]} />
        <meshStandardMaterial color={skin} />
      </mesh>
      <mesh position={[0.14, 0.18, 0]} castShadow>
        <boxGeometry args={[0.18, 0.4, 0.2]} />
        <meshStandardMaterial color={skin} />
      </mesh>
      {controlled && (
        <mesh position={[0, 2.1, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.18, 0.3, 8]} />
          <meshStandardMaterial color="#ffdd33" emissive="#ffaa00" emissiveIntensity={0.6} />
        </mesh>
      )}
    </group>
  );
}

export function PlayersGroup({ players }: { players: PlayerState[] }) {
  return (
    <group>
      {players.map((p) => (
        <Player key={p.id} playerId={p.id} />
      ))}
    </group>
  );
}
