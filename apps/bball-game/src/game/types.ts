import type { Object3D } from "three";

export type TeamId = "home" | "away";

export interface PlayerState {
  id: number;
  team: TeamId;
  isHuman: boolean;
  pos: [number, number, number];
  vel: [number, number, number];
  facing: number;
  shotCooldown: number;
  formationSpot: [number, number, number];
  ref?: Object3D | null;
  markId?: number;
}

export interface BallState {
  pos: [number, number, number];
  vel: [number, number, number];
  holderId: number | null;
  spin: [number, number, number];
  ref?: Object3D | null;
  lastShooter: number | null;
  lastShotFrom: [number, number, number] | null;
  lastScoreAt: number;
}

export const COURT = {
  length: 28,
  width: 15,
  hoopY: 3.05,
  rimR: 0.2286,
  ballR: 0.12,
  backboardOffsetZ: 0.3,
} as const;

export function hoopFor(team: TeamId): [number, number, number] {
  return team === "home"
    ? [0, COURT.hoopY, COURT.length / 2 - 1.2 + COURT.backboardOffsetZ]
    : [0, COURT.hoopY, -COURT.length / 2 + 1.2 - COURT.backboardOffsetZ];
}

export function ownHoopFor(team: TeamId): [number, number, number] {
  return hoopFor(team === "home" ? "away" : "home");
}

export function teamSign(team: TeamId): number {
  return team === "home" ? 1 : -1;
}
