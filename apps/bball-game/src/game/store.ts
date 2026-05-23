import { create } from "zustand";
import { COURT, type BallState, type PlayerState, type TeamId, teamSign } from "./types";

interface UIState {
  scoreHome: number;
  scoreAway: number;
  quarter: number;
  clock: number;
  banner: string;
  bannerUntil: number;
  controlledId: number;
  paused: boolean;
}

interface GameStore extends UIState {
  ball: BallState;
  players: PlayerState[];
  bump: (patch: Partial<UIState>) => void;
  setBanner: (msg: string, seconds: number) => void;
  setControlled: (id: number) => void;
}

function makePlayers(): PlayerState[] {
  const formations: Record<TeamId, [number, number, number][]> = {
    home: [
      [0, 0, -2.0],
      [-3.5, 0, -4.5],
      [3.5, 0, -4.5],
      [-5.5, 0, -9.0],
      [5.5, 0, -9.0],
    ],
    away: [
      [0, 0, 2.0],
      [-3.5, 0, 4.5],
      [3.5, 0, 4.5],
      [-5.5, 0, 9.0],
      [5.5, 0, 9.0],
    ],
  };
  const out: PlayerState[] = [];
  let id = 0;
  for (const team of ["home", "away"] as const) {
    for (const spot of formations[team]) {
      out.push({
        id,
        team,
        isHuman: id === 0,
        pos: [...spot] as [number, number, number],
        vel: [0, 0, 0],
        facing: team === "home" ? 0 : Math.PI,
        shotCooldown: 0,
        formationSpot: [...spot] as [number, number, number],
      });
      id++;
    }
  }
  return out;
}

export const useGame = create<GameStore>((set) => ({
  scoreHome: 0,
  scoreAway: 0,
  quarter: 1,
  clock: 120,
  banner: "Tip-off!",
  bannerUntil: 1.5,
  controlledId: 0,
  paused: false,
  ball: {
    pos: [0, 1.5, 0],
    vel: [0, 0, 0],
    holderId: null,
    spin: [0, 0, 0],
    lastShooter: null,
    lastShotFrom: null,
    lastScoreAt: -10,
  },
  players: makePlayers(),
  bump: (patch) => set(patch),
  setBanner: (msg, seconds) => set({ banner: msg, bannerUntil: seconds }),
  setControlled: (id) => set({ controlledId: id }),
}));

export function resetPositions() {
  const players = useGame.getState().players;
  for (const p of players) {
    p.pos[0] = p.formationSpot[0];
    p.pos[1] = p.formationSpot[1];
    p.pos[2] = p.formationSpot[2];
    p.vel[0] = p.vel[1] = p.vel[2] = 0;
  }
  const ball = useGame.getState().ball;
  ball.pos[0] = 0;
  ball.pos[1] = 2.5;
  ball.pos[2] = 0;
  ball.vel[0] = ball.vel[1] = ball.vel[2] = 0;
  ball.holderId = null;
}

export function teamOf(id: number): TeamId {
  return id < 5 ? "home" : "away";
}

export function teammatesOf(id: number): PlayerState[] {
  const t = teamOf(id);
  return useGame.getState().players.filter((p) => p.team === t && p.id !== id);
}

export function opponentsOf(id: number): PlayerState[] {
  const t = teamOf(id);
  return useGame.getState().players.filter((p) => p.team !== t);
}

export const WORLD = {
  ...COURT,
  gravity: -9.81,
  ballRestitution: 0.65,
  ballAirDrag: 0.02,
  playerRadius: 0.45,
  playerHeight: 2.0,
  playerSpeed: 6.5,
  playerSprintMul: 1.35,
  playerAccel: 22,
  pickupReach: 1.0,
};

export { teamSign };
