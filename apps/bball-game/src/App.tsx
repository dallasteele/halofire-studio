import { Canvas } from "@react-three/fiber";
import { Scene } from "./game/Scene";
import { HUD } from "./game/HUD";

export default function App() {
  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <Canvas shadows camera={{ position: [0, 8, -16], fov: 55, near: 0.1, far: 200 }}>
        <color attach="background" args={["#0e0f12"]} />
        <Scene />
      </Canvas>
      <HUD />
    </div>
  );
}
