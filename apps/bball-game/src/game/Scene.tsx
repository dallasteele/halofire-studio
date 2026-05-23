import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useGame } from "./store";
import { Court } from "./Court";
import { Ball } from "./Ball";
import { PlayersGroup } from "./Player";
import {
  aimAt,
  applyPlayerMove,
  detectScore,
  followHolder,
  handleScore,
  nearestSwitchable,
  nearestTeammate,
  pass,
  shoot,
  stepAI,
  stepBallPhysics,
  tickClock,
  tryPickup,
} from "./physics";
import { hoopFor } from "./types";

type Keys = { [k: string]: boolean };
const keys: Keys = {};
const mouse = { x: 0, y: 0, leftDown: false, leftHeld: 0, rightDown: false, rightYaw: 0, dragging: false };

function attachInput() {
  const onKey = (e: KeyboardEvent) => {
    keys[e.code] = e.type === "keydown";
    if (e.code === "Tab" && e.type === "keydown") e.preventDefault();
  };
  const onDown = (e: MouseEvent) => {
    if (e.button === 0) {
      mouse.leftDown = true;
      mouse.leftHeld = 0;
    }
    if (e.button === 2) mouse.rightDown = true;
    if (e.button === 1) {
      mouse.dragging = true;
      e.preventDefault();
    }
  };
  const onUp = (e: MouseEvent) => {
    if (e.button === 0) mouse.leftDown = false;
    if (e.button === 1) mouse.dragging = false;
  };
  const onMove = (e: MouseEvent) => {
    if (mouse.dragging) mouse.rightYaw += e.movementX * 0.005;
  };
  const onCtx = (e: Event) => e.preventDefault();
  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKey);
  window.addEventListener("mousedown", onDown);
  window.addEventListener("mouseup", onUp);
  window.addEventListener("mousemove", onMove);
  window.addEventListener("contextmenu", onCtx);
  return () => {
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("keyup", onKey);
    window.removeEventListener("mousedown", onDown);
    window.removeEventListener("mouseup", onUp);
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("contextmenu", onCtx);
  };
}

export function Scene() {
  const { camera } = useThree();
  const camStateRef = useRef({ yaw: 0, init: false });

  useEffect(() => attachInput(), []);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const st = useGame.getState();
    if (st.paused) return;

    const human = st.players[st.controlledId];
    const ball = st.ball;
    const camRef = camStateRef.current;
    if (!camRef.init) {
      camRef.yaw = 0;
      camRef.init = true;
    }
    camRef.yaw = mouse.rightYaw;

    const yaw = camRef.yaw + (human.team === "home" ? 0 : Math.PI);
    const camForward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const camRight = new THREE.Vector3(camForward.z, 0, -camForward.x);

    const fwd = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
    const rt = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    const dir = new THREE.Vector3()
      .addScaledVector(camForward, fwd)
      .addScaledVector(camRight, rt);
    const desired: [number, number, number] = [dir.x, 0, dir.z];
    const sprint = !!keys.ShiftLeft || !!keys.ShiftRight;

    applyPlayerMove(human, dt, desired, sprint);
    if (human.shotCooldown > 0) human.shotCooldown -= dt;

    if (ball.holderId === human.id) {
      const target = hoopFor(human.team);
      aimAt(human, target);
      if (mouse.leftDown) mouse.leftHeld += dt;
      if (!mouse.leftDown && mouse.leftHeld > 0) {
        const power = Math.min(1, mouse.leftHeld / 0.6);
        shoot(ball, human, target, power);
        mouse.leftHeld = 0;
      }
      if (mouse.rightDown) {
        const mate = nearestTeammate(human);
        if (mate) pass(ball, human, mate);
        mouse.rightDown = false;
      }
    } else {
      mouse.leftHeld = 0;
      mouse.rightDown = false;
      if (keys.KeyE || keys.Space) tryPickup(ball, human);
    }

    if (keys.Tab) {
      const next = nearestSwitchable(human, ball);
      if (next && next.id !== human.id) {
        st.setControlled(next.id);
      }
      keys.Tab = false;
    }

    for (const p of st.players) {
      if (p.id === st.controlledId) continue;
      stepAI(p, ball, dt);
    }

    if (ball.holderId !== null) {
      const holder = st.players[ball.holderId];
      followHolder(ball, holder);
    } else {
      stepBallPhysics(ball, dt);
      const now = performance.now() / 1000;
      const scoredFor = detectScore(ball, now);
      if (scoredFor) handleScore(scoredFor, ball);
    }

    tickClock(dt);

    const camOffset = new THREE.Vector3(-camForward.x * 9, 6.5, -camForward.z * 9);
    const camTarget = new THREE.Vector3(human.pos[0], human.pos[1] + 1.5, human.pos[2]);
    const desiredPos = camTarget.clone().add(camOffset);
    camera.position.lerp(desiredPos, Math.min(1, dt * 6));
    camera.lookAt(camTarget);
  });

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight
        position={[10, 18, 8]}
        intensity={1.1}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
      />
      <Court />
      <PlayersGroup players={useGame.getState().players} />
      <Ball />
      <fog attach="fog" args={["#0e0f12", 30, 80]} />
    </>
  );
}
