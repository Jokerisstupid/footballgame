/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Point {
  x: number;
  y: number;
}

export interface Point3D {
  x: number;
  y: number;
  z: number; // 0 = at penalty spot, 1 = at goal line
}

export interface Vector {
  vx: number;
  vy: number;
}

export type GoalZone = 
  | 'top-left'      // Top Bins 500pts
  | 'top-right'     // Top Bins 500pts
  | 'top-center'    // Roof of Net 350pts
  | 'bottom-left'   // Low Corner 300pts
  | 'bottom-right'  // Low Corner 300pts
  | 'bottom-center' // Low Center 200pts
  | 'post'          // Woodwork 100pts
  | 'miss';         // Off Target 0pts

export type BallSkin = 'classic' | 'gold' | 'fire' | 'neon';

export interface BallSkinConfig {
  id: BallSkin;
  name: string;
  bonus: string;
  multiplier: number;
  color: string;
  trailColor: string;
}

export type GkDiveDirection = 
  | 'idle'
  | 'left'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'center';

export type GkReactionState = 'ready' | 'anticipating' | 'diving' | 'saved' | 'beaten';

export interface GoalkeeperState {
  x: number;
  y: number;
  width: number;
  height: number;
  diveDirection: GkDiveDirection;
  state: GkReactionState;
  diveProgress: number; // 0 to 1
  bodyTilt: number;     // in radians
  armExtension: number; // reach factor
  skillLevel: number;   // 0.4 to 0.95
  tendency: 'favors_right' | 'favors_left' | 'balanced' | 'aggressive_high';
}

export interface PenaltyTarget {
  id: GoalZone;
  label: string;
  points: number;
  x: number;
  y: number;
  width: number;
  height: number;
  difficulty: 'Easy' | 'Medium' | 'Hard' | 'Extreme';
  description: string;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  color: string;
}

export interface ShotResult {
  outcome: 'goal' | 'saved' | 'post' | 'miss';
  zone: GoalZone;
  speedKmh: number;
  points: number;
  spin: number;
  xG: number;
  message: string;
}

export interface ShootoutRound {
  attempt: number;
  scored: boolean | null; // null if not attempted yet
  points: number;
  speedKmh?: number;
  zone?: GoalZone;
}

export interface TacticalContext {
  round: number;
  maxRounds: number;
  score: number;
  streak: number;
  gkSkill: number;
  gkTendency: string;
  previousAttempts: Array<{ scored: boolean | null; zone?: string }>;
  availableBalls: BallSkin[];
  activeBall: BallSkin;
  windMph: number;
}

export interface StrategicHint {
  message: string;
  rationale?: string;
  recommendedZone?: GoalZone;
  targetX?: number;
  targetY?: number;
  recommendedBall?: BallSkin;
  goalkeeperAnalysis?: string;
  shotPowerAdvice?: string;
  curveAdvice?: string;
  expectedGoalRate?: number; // 0 to 100%
}

export interface DebugInfo {
  latency: number;
  screenshotBase64?: string;
  promptContext: string;
  rawResponse: string;
  parsedResponse?: any;
  error?: string;
  timestamp: string;
}

export interface AiResponse {
  hint: StrategicHint;
  debug: DebugInfo;
}

// MediaPipe Type Definitions (Augmenting window)
declare global {
  interface Window {
    Hands: any;
    Camera: any;
    drawConnectors: any;
    drawLandmarks: any;
    HAND_CONNECTIONS: any;
  }
}
