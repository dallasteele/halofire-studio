import { WORLD, useGame, teamOf, opponentsOf, teammatesOf, resetPositions } from "./store";
import type { BallState, PlayerState, TeamId } from "./types";
import { hoopFor, ownHoopFor } from "./types";
import { playBounce, playPass, playShot, playSwish, playBuzzer } from "./audio";

const FRICTION_GROUND = 6;

export function stepBallPhysics(b: BallState, dt: number) {
  if (b.holderId !== null) return;
  b.vel[1] += WORLD.gravity * dt;
  const drag = 1 - WORLD.ballAirDrag * dt;
  b.vel[0] *= drag;
  b.vel[2] *= drag;
  b.pos[0] += b.vel[0] * dt;
  b.pos[1] += b.vel[1] * dt;
  b.pos[2] += b.vel[2] * dt;

  if (b.pos[1] - WORLD.ballR < 0) {
    b.pos[1] = WORLD.ballR;
    if (Math.abs(b.vel[1]) > 0.5) playBounce(Math.min(1, Math.abs(b.vel[1]) / 8));
    b.vel[1] = -b.vel[1] * WORLD.ballRestitution;
    b.vel[0] *= 0.85;
    b.vel[2] *= 0.85;
  }

  for (const team of ["home", "away"] as TeamId[]) {
    const hp = hoopFor(team);
    bounceOffRim(b, hp[0], hp[1], hp[2]);
    bounceOffBackboard(b, hp[0], hp[1], hp[2], team === "home" ? +1 : -1);
  }

  const hw = WORLD.width / 2 + 1.5;
  const hl = WORLD.length / 2 + 1.5;
  if (Math.abs(b.pos[0]) > hw + 6 || Math.abs(b.pos[2]) > hl + 6) {
    resetPositions();
    useGame.getState().setBanner("Out of bounds", 1);
  }
}

function bounceOffRim(b: BallState, rx: number, ry: number, rz: number) {
  const dy = b.pos[1] - ry;
  if (Math.abs(dy) > WORLD.ballR + 0.04) return;
  const dx = b.pos[0] - rx;
  const dz = b.pos[2] - rz;
  const d = Math.hypot(dx, dz);
  const rimR = WORLD.rimR;
  if (d > rimR - WORLD.ballR && d < rimR + WORLD.ballR + 0.04) {
    const nx = dx / (d || 1);
    const nz = dz / (d || 1);
    const vn = b.vel[0] * nx + b.vel[2] * nz;
    if (vn < 0) {
      b.vel[0] -= 1.6 * vn * nx;
      b.vel[2] -= 1.6 * vn * nz;
      b.vel[0] *= 0.6;
      b.vel[2] *= 0.6;
      b.vel[1] = Math.abs(b.vel[1]) * 0.4 + 0.5;
      playBounce(0.3);
    }
    const overlap = rimR + WORLD.ballR - d;
    if (overlap > 0) {
      b.pos[0] += nx * overlap;
      b.pos[2] += nz * overlap;
    }
  }
}

function bounceOffBackboard(b: BallState, rx: number, ry: number, rz: number, sideSign: number) {
  const boardZ = rz + sideSign * 0.3;
  const boardW = 1.8;
  const boardH = 1.05;
  const boardCenterY = ry + 0.15;
  const halfW = boardW / 2;
  const halfH = boardH / 2;
  if (Math.abs(b.pos[0] - rx) > halfW + WORLD.ballR) return;
  if (Math.abs(b.pos[1] - boardCenterY) > halfH + WORLD.ballR) return;
  const dz = b.pos[2] - boardZ;
  if (Math.abs(dz) > WORLD.ballR + 0.05) return;
  if (Math.sign(b.vel[2]) === Math.sign(sideSign)) {
    b.vel[2] = -b.vel[2] * 0.7;
    b.pos[2] = boardZ - sideSign * (WORLD.ballR + 0.05);
    playBounce(0.5);
  }
}

export function tryPickup(b: BallState, p: PlayerState) {
  if (b.holderId !== null) return false;
  if (p.shotCooldown > 0) return false;
  const dx = b.pos[0] - p.pos[0];
  const dy = b.pos[1] - (p.pos[1] + 1.3);
  const dz = b.pos[2] - p.pos[2];
  if (Math.hypot(dx, dy, dz) > WORLD.pickupReach) return false;
  attach(b, p);
  return true;
}

export function attach(b: BallState, p: PlayerState) {
  b.holderId = p.id;
  b.vel[0] = b.vel[1] = b.vel[2] = 0;
  followHolder(b, p);
}

export function followHolder(b: BallState, p: PlayerState) {
  const hx = Math.sin(p.facing) * 0.45;
  const hz = Math.cos(p.facing) * 0.45;
  b.pos[0] = p.pos[0] + hx;
  b.pos[1] = p.pos[1] + 1.25;
  b.pos[2] = p.pos[2] + hz;
}

export function shoot(b: BallState, p: PlayerState, target: [number, number, number], power = 1) {
  if (b.holderId !== p.id) return false;
  if (p.shotCooldown > 0) return false;
  const start: [number, number, number] = [b.pos[0], b.pos[1], b.pos[2]];
  const tx = target[0] - start[0];
  const ty = target[1] - start[1];
  const tz = target[2] - start[2];
  const horiz = Math.hypot(tx, tz);
  const g = -WORLD.gravity;
  const angle = (Math.PI / 180) * (48 + Math.min(12, horiz));
  const denom = 2 * Math.cos(angle) * Math.cos(angle) * (horiz * Math.tan(angle) - ty);
  if (denom <= 0) return false;
  let speed = Math.sqrt((g * horiz * horiz) / denom);
  speed *= 0.98 + (1 - power) * 0.08;
  const dirX = tx / (horiz || 1);
  const dirZ = tz / (horiz || 1);
  const vx = dirX * Math.cos(angle) * speed;
  const vz = dirZ * Math.cos(angle) * speed;
  const vy = Math.sin(angle) * speed;
  const skill = 0.95 + Math.random() * 0.12;
  const jitter = 0.35 * (1 - Math.min(1, Math.max(0, (1 - horiz / 9))));
  b.vel[0] = vx * skill + (Math.random() - 0.5) * jitter;
  b.vel[1] = vy * skill;
  b.vel[2] = vz * skill + (Math.random() - 0.5) * jitter;
  b.holderId = null;
  p.shotCooldown = 0.6;
  b.lastShooter = p.id;
  b.lastShotFrom = [...start] as [number, number, number];
  playShot();
  return true;
}

export function pass(b: BallState, from: PlayerState, to: PlayerState) {
  if (b.holderId !== from.id) return false;
  const start: [number, number, number] = [b.pos[0], b.pos[1], b.pos[2]];
  const targetLead = [
    to.pos[0] + to.vel[0] * 0.35,
    to.pos[1] + 1.3,
    to.pos[2] + to.vel[2] * 0.35,
  ];
  const dx = targetLead[0] - start[0];
  const dy = targetLead[1] - start[1];
  const dz = targetLead[2] - start[2];
  const dist = Math.hypot(dx, dy, dz);
  const t = Math.max(0.25, Math.min(0.7, dist / 16));
  b.vel[0] = dx / t;
  b.vel[1] = dy / t + 0.5 * -WORLD.gravity * t;
  b.vel[2] = dz / t;
  b.holderId = null;
  from.shotCooldown = 0.2;
  playPass();
  return true;
}

export function detectScore(b: BallState, tNow: number): TeamId | null {
  if (tNow - b.lastScoreAt < 1.2) return null;
  for (const team of ["home", "away"] as TeamId[]) {
    const hp = hoopFor(team);
    const dy = b.pos[1] - hp[1];
    if (dy > -0.15 && dy < 0.05 && b.vel[1] < -0.5) {
      const d = Math.hypot(b.pos[0] - hp[0], b.pos[2] - hp[2]);
      if (d < WORLD.rimR - WORLD.ballR + 0.04) {
        b.lastScoreAt = tNow;
        return team === "home" ? "away" : "home";
      }
    }
  }
  return null;
}

export function applyPlayerMove(p: PlayerState, dt: number, desiredVel: [number, number, number], sprint: boolean) {
  const target = WORLD.playerSpeed * (sprint ? WORLD.playerSprintMul : 1);
  let dx = desiredVel[0];
  let dz = desiredVel[2];
  const m = Math.hypot(dx, dz);
  if (m > 1) {
    dx /= m;
    dz /= m;
  }
  const wantX = dx * target;
  const wantZ = dz * target;
  p.vel[0] += (wantX - p.vel[0]) * Math.min(1, WORLD.playerAccel * dt);
  p.vel[2] += (wantZ - p.vel[2]) * Math.min(1, WORLD.playerAccel * dt);
  if (m < 0.05) {
    p.vel[0] -= p.vel[0] * Math.min(1, FRICTION_GROUND * dt);
    p.vel[2] -= p.vel[2] * Math.min(1, FRICTION_GROUND * dt);
  }
  p.pos[0] += p.vel[0] * dt;
  p.pos[2] += p.vel[2] * dt;
  const hw = WORLD.width / 2 - 0.4;
  const hl = WORLD.length / 2 - 0.4;
  p.pos[0] = Math.max(-hw, Math.min(hw, p.pos[0]));
  p.pos[2] = Math.max(-hl, Math.min(hl, p.pos[2]));
  if (Math.hypot(p.vel[0], p.vel[2]) > 0.05) {
    p.facing = Math.atan2(p.vel[0], p.vel[2]);
  }
}

export function stepAI(p: PlayerState, b: BallState, dt: number) {
  const team = teamOf(p.id);
  const targetHoop = hoopFor(team);
  const ownHoop = ownHoopFor(team);
  const hasBall = b.holderId === p.id;
  const teammateHasBall = b.holderId !== null && teamOf(b.holderId) === team && !hasBall;
  const oppHasBall = b.holderId !== null && teamOf(b.holderId) !== team;

  let desired: [number, number, number] = [0, 0, 0];
  let sprint = false;

  if (hasBall) {
    const tx = targetHoop[0] - p.pos[0];
    const tz = targetHoop[2] - p.pos[2];
    const dist = Math.hypot(tx, tz);
    const shotRange = 5 + Math.random() * 3;
    if (dist < shotRange && p.shotCooldown <= 0 && Math.random() < 0.06) {
      shoot(b, p, targetHoop, 0.5 + Math.random() * 0.3);
      return;
    }
    desired = [tx / (dist || 1), 0, tz / (dist || 1)];
    sprint = dist > 8;
  } else if (teammateHasBall) {
    const fanout = Math.sin(performance.now() * 0.0006 + p.id) * 2.2;
    const tx = targetHoop[0] - p.pos[0] + fanout;
    const tz = targetHoop[2] * 0.6 - p.pos[2];
    const d = Math.hypot(tx, tz);
    desired = [tx / (d || 1), 0, tz / (d || 1)];
  } else if (b.holderId === null) {
    const tx = b.pos[0] - p.pos[0];
    const tz = b.pos[2] - p.pos[2];
    const d = Math.hypot(tx, tz);
    desired = [tx / (d || 1), 0, tz / (d || 1)];
    sprint = true;
    tryPickup(b, p);
  } else if (oppHasBall) {
    if (p.markId === undefined || Math.random() < 0.01) {
      const opps = opponentsOf(p.id);
      let best: PlayerState | null = null;
      let bestD = Infinity;
      for (const o of opps) {
        const d = Math.hypot(o.pos[0] - p.pos[0], o.pos[2] - p.pos[2]);
        if (d < bestD) {
          bestD = d;
          best = o;
        }
      }
      if (best) p.markId = best.id;
    }
    const mark = useGame.getState().players[p.markId ?? 0];
    if (mark) {
      const between: [number, number, number] = [
        mark.pos[0] * 0.65 + ownHoop[0] * 0.35,
        0,
        mark.pos[2] * 0.65 + ownHoop[2] * 0.35,
      ];
      const tx = between[0] - p.pos[0];
      const tz = between[2] - p.pos[2];
      const d = Math.hypot(tx, tz);
      desired = [tx / (d || 1), 0, tz / (d || 1)];
      sprint = d > 3;
    }
  }

  applyPlayerMove(p, dt, desired, sprint);
  if (p.shotCooldown > 0) p.shotCooldown -= dt;
}

export function aimAt(p: PlayerState, target: [number, number, number]) {
  const dx = target[0] - p.pos[0];
  const dz = target[2] - p.pos[2];
  p.facing = Math.atan2(dx, dz);
}

export function nearestTeammate(p: PlayerState): PlayerState | null {
  const mates = teammatesOf(p.id);
  let best: PlayerState | null = null;
  let bestD = Infinity;
  const fx = p.pos[0] + Math.sin(p.facing) * 4;
  const fz = p.pos[2] + Math.cos(p.facing) * 4;
  for (const m of mates) {
    const d = Math.hypot(m.pos[0] - fx, m.pos[2] - fz);
    if (d < bestD) {
      bestD = d;
      best = m;
    }
  }
  return best;
}

export function nearestSwitchable(p: PlayerState, b: BallState): PlayerState | null {
  const mates = teammatesOf(p.id);
  const fx = b.holderId !== null ? b.pos[0] : b.pos[0];
  const fz = b.holderId !== null ? b.pos[2] : b.pos[2];
  let best: PlayerState | null = null;
  let bestD = Infinity;
  for (const m of mates) {
    const d = Math.hypot(m.pos[0] - fx, m.pos[2] - fz);
    if (d < bestD) {
      bestD = d;
      best = m;
    }
  }
  return best;
}

export function handleScore(scoredFor: TeamId, b: BallState) {
  const st = useGame.getState();
  const fromX = b.lastShotFrom?.[0] ?? 0;
  const fromZ = b.lastShotFrom?.[2] ?? 0;
  const hp = hoopFor(scoredFor === "home" ? "away" : "home");
  const shotDist = Math.hypot(fromX - hp[0], fromZ - hp[2]);
  const pts = shotDist > 6.75 ? 3 : 2;
  if (scoredFor === "home") st.bump({ scoreHome: st.scoreHome + pts });
  else st.bump({ scoreAway: st.scoreAway + pts });
  st.setBanner(`+${pts}`, 1.2);
  playSwish();
  setTimeout(() => {
    resetPositions();
    useGame.getState().setBanner("", 0);
  }, 1500);
}

export function tickClock(dt: number) {
  const st = useGame.getState();
  if (st.bannerUntil > 0) st.bump({ bannerUntil: Math.max(0, st.bannerUntil - dt) });
  const next = st.clock - dt;
  if (next <= 0) {
    if (st.quarter >= 4) {
      playBuzzer();
      st.bump({ clock: 0, banner: `Final ${st.scoreHome}-${st.scoreAway}`, bannerUntil: 999, paused: true });
    } else {
      playBuzzer();
      st.bump({ clock: 120, quarter: st.quarter + 1, banner: `Q${st.quarter + 1}`, bannerUntil: 2 });
      resetPositions();
    }
  } else {
    st.bump({ clock: next });
  }
}
