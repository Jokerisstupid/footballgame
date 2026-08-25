/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import confetti from 'canvas-confetti';
import { 
  Point, 
  Point3D, 
  GoalZone, 
  BallSkin, 
  BallSkinConfig, 
  GoalkeeperState, 
  PenaltyTarget, 
  Particle, 
  ShotResult, 
  ShootoutRound, 
  DebugInfo, 
  StrategicHint 
} from '../types';
import { getPenaltyTactics } from '../services/geminiService';
import { soundEffects } from '../utils/audio';
import { 
  Trophy, 
  BrainCircuit, 
  RotateCcw, 
  Camera, 
  MousePointer, 
  Volume2, 
  VolumeX, 
  Zap, 
  Gauge, 
  Target, 
  Sparkles, 
  HelpCircle,
  Eye,
  Terminal,
  AlertTriangle,
  Lightbulb,
  ShieldAlert,
  Sliders,
  ChevronRight,
  Hand,
  Crosshair,
  Wind,
  CheckCircle2,
  Flame,
  Activity,
  X,
  Menu,
  Settings as SettingsIcon,
  SlidersHorizontal,
  BookOpen,
  Layers
} from 'lucide-react';

const PINCH_THRESHOLD = 0.065;
const MAX_DRAG_DIST = 160;
const BALL_BASE_RADIUS = 32;

export const BALL_SKINS: Record<BallSkin, BallSkinConfig> = {
  classic: {
    id: 'classic',
    name: 'Champions Classic',
    bonus: 'Standard Match Ball',
    multiplier: 1.0,
    color: '#ffffff',
    trailColor: '#e0e0e0'
  },
  gold: {
    id: 'gold',
    name: 'Golden Ballon d’Or',
    bonus: '2x Score Multiplier',
    multiplier: 2.0,
    color: '#ffd700',
    trailColor: '#ffb300'
  },
  fire: {
    id: 'fire',
    name: 'Inferno Velocity',
    bonus: '+20% Shot Speed & Power',
    multiplier: 1.25,
    color: '#ff5722',
    trailColor: '#ff9800'
  },
  neon: {
    id: 'neon',
    name: 'Cyber Jabulani',
    bonus: '+35% Extreme Curve Control',
    multiplier: 1.5,
    color: '#00e5ff',
    trailColor: '#d500f9'
  }
};

interface NetNode {
  x: number;
  y: number;
  baseX: number;
  baseY: number;
  vz: number;
  z: number;
}

const FootballPenalty: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // --- Game Engine Physics Refs ---
  const penaltySpotRef = useRef<Point>({ x: 0, y: 0 });
  const ball3D = useRef<Point3D>({ x: 0, y: 0, z: 0 });
  const ballVel3D = useRef<{ vx: number; vy: number; vz: number }>({ vx: 0, vy: 0, vz: 0 });
  const ballSpin = useRef<number>(0);
  const ballRotation = useRef<number>(0);
  const isBallFlying = useRef<boolean>(false);
  const isPinching = useRef<boolean>(false);
  const isDraggingMouse = useRef<boolean>(false);
  const dragStart = useRef<Point>({ x: 0, y: 0 });
  const dragCurrent = useRef<Point>({ x: 0, y: 0 });
  const dragPointsHistory = useRef<{ x: number; y: number; time: number }[]>([]);
  const flightStartTime = useRef<number>(0);
  const particles = useRef<Particle[]>([]);
  const lastShotResult = useRef<ShotResult | null>(null);

  // Hand tracking state refs
  const smoothedHandPos = useRef<Point | null>(null);
  const handLandmarksRef = useRef<any[] | null>(null);
  const handStateLabel = useRef<'Searching...' | 'Open Hand' | 'Aiming / Pinching' | 'Striking'>('Searching...');
  const handPinchConfidence = useRef<number>(0);

  // Dynamic Net Mesh Ripple Simulation
  const netGrid = useRef<NetNode[][]>([]);
  const netRippleActive = useRef<boolean>(false);

  // Goal & Goalkeeper Geometry
  const goalBox = useRef<{ x: number; y: number; width: number; height: number; depth: number }>({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    depth: 80
  });

  const gkStateRef = useRef<GoalkeeperState>({
    x: 0,
    y: 0,
    width: 90,
    height: 140,
    diveDirection: 'idle',
    state: 'ready',
    diveProgress: 0,
    bodyTilt: 0,
    armExtension: 1,
    skillLevel: 0.70,
    tendency: 'balanced'
  });

  const gkIdleAnimTimer = useRef<number>(0);

  // AI & Capture triggers
  const isAiThinkingRef = useRef<boolean>(false);
  const captureRequestRef = useRef<boolean>(false);
  const activeBallRef = useRef<BallSkin>('classic');

  // --- React State ---
  const [loading, setLoading] = useState(true);
  const [useCamera, setUseCamera] = useState(true);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [lastSpeed, setLastSpeed] = useState(0);
  const [bestSpeed, setBestSpeed] = useState(0);
  const [activeBall, setActiveBall] = useState<BallSkin>('classic');
  const [shootMode, setShootMode] = useState<'smart' | 'flick' | 'slingshot'>('smart');
  
  const [roundKicks, setRoundKicks] = useState<ShootoutRound[]>([
    { attempt: 1, scored: null, points: 0 },
    { attempt: 2, scored: null, points: 0 },
    { attempt: 3, scored: null, points: 0 },
    { attempt: 4, scored: null, points: 0 },
    { attempt: 5, scored: null, points: 0 }
  ]);
  const [currentRoundIdx, setCurrentRoundIdx] = useState(0);
  const [difficulty, setDifficulty] = useState<'Rookie' | 'Pro' | 'World Class' | 'Legendary'>('Pro');
  const [recentResult, setRecentResult] = useState<ShotResult | null>(null);
  const [isMatchOver, setIsMatchOver] = useState(false);
  const [windSpeed, setWindSpeed] = useState(4);

  // AI Tactical State
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [aiHint, setAiHint] = useState<StrategicHint>({
    message: "Analyzing Goalkeeper Stance & Balance...",
    rationale: "Goalkeeper positioned centrally. Upper corners (Top Bins) offer 88% goal probability.",
    recommendedZone: 'top-left',
    expectedGoalRate: 88,
    shotPowerAdvice: "80-90% power with inward whip."
  });
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const [showAiReticle, setShowAiReticle] = useState(true);
  const [handDetected, setHandDetected] = useState(false);
  const [handTrackingInfo, setHandTrackingInfo] = useState({ state: 'Ready', confidence: 0 });
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<'coach' | 'settings' | 'balls' | 'guide'>('coach');

  // Sync refs
  const showSkeletonRef = useRef<boolean>(showSkeleton);
  const difficultyRef = useRef(difficulty);
  const resultBannerTimerRef = useRef<any>(null);
  const aiRequestIdRef = useRef<number>(0);

  useEffect(() => {
    showSkeletonRef.current = showSkeleton;
  }, [showSkeleton]);

  useEffect(() => {
    difficultyRef.current = difficulty;
  }, [difficulty]);

  useEffect(() => {
    activeBallRef.current = activeBall;
  }, [activeBall]);

  useEffect(() => {
    isAiThinkingRef.current = isAiThinking;
  }, [isAiThinking]);

  useEffect(() => {
    return () => {
      if (resultBannerTimerRef.current) {
        clearTimeout(resultBannerTimerRef.current);
      }
    };
  }, []);

  // Sound Mute Toggle
  const handleToggleMute = () => {
    const muted = soundEffects.toggleMute();
    setIsMuted(muted);
  };

  // Initialize Net Grid
  const initNetGrid = useCallback((gb: { x: number; y: number; width: number; height: number }) => {
    const cols = 22;
    const rows = 12;
    const grid: NetNode[][] = [];

    for (let r = 0; r <= rows; r++) {
      const rowArr: NetNode[] = [];
      const ny = gb.y + (r / rows) * gb.height;
      for (let c = 0; c <= cols; c++) {
        const nx = gb.x + (c / cols) * gb.width;
        rowArr.push({
          x: nx,
          y: ny,
          baseX: nx,
          baseY: ny,
          vz: 0,
          z: 0
        });
      }
      grid.push(rowArr);
    }
    netGrid.current = grid;
  }, []);

  // Trigger Net Ripple on Goal
  const triggerNetRipple = (impactX: number, impactY: number) => {
    netRippleActive.current = true;
    const grid = netGrid.current;
    if (!grid || grid.length === 0) return;

    soundEffects.playNetRustle();

    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[r].length; c++) {
        const node = grid[r][c];
        const dist = Math.hypot(node.baseX - impactX, node.baseY - impactY);
        if (dist < 180) {
          const force = (1 - dist / 180) * 35;
          node.z = force;
          node.vz = -force * 0.3;
        }
      }
    }
  };

  // Reset Penalty for next kick
  const resetBallToSpot = useCallback(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    penaltySpotRef.current = {
      x: canvas.width / 2,
      y: canvas.height - 130
    };
    ball3D.current = {
      x: penaltySpotRef.current.x,
      y: penaltySpotRef.current.y,
      z: 0
    };
    ballVel3D.current = { vx: 0, vy: 0, vz: 0 };
    ballSpin.current = 0;
    isBallFlying.current = false;
    isPinching.current = false;
    isDraggingMouse.current = false;
    dragPointsHistory.current = [];

    // Reset Goalkeeper Tendency
    const tendencies: GoalkeeperState['tendency'][] = ['favors_left', 'favors_right', 'balanced', 'aggressive_high'];
    const randomTendency = tendencies[Math.floor(Math.random() * tendencies.length)];
    
    let skill = 0.70;
    const currentDiff = difficultyRef.current;
    if (currentDiff === 'Rookie') skill = 0.45;
    if (currentDiff === 'World Class') skill = 0.84;
    if (currentDiff === 'Legendary') skill = 0.92;

    gkStateRef.current = {
      x: goalBox.current.x + goalBox.current.width / 2,
      y: goalBox.current.y + goalBox.current.height - 40,
      width: 90,
      height: 140,
      diveDirection: 'idle',
      state: 'ready',
      diveProgress: 0,
      bodyTilt: 0,
      armExtension: 1,
      skillLevel: skill,
      tendency: randomTendency
    };

    setWindSpeed(Math.floor(Math.random() * 14) - 7);
    soundEffects.playWhistle();

    // Clear any lingering shot outcome banner when new kick is ready
    if (resultBannerTimerRef.current) {
      clearTimeout(resultBannerTimerRef.current);
    }
    setRecentResult(null);

    // Trigger AI Tactical Vision Analysis in background
    setTimeout(() => {
      captureRequestRef.current = true;
    }, 400);
  }, []);

  // Restart Entire Match (5 Kicks)
  const restartMatch = () => {
    if (resultBannerTimerRef.current) {
      clearTimeout(resultBannerTimerRef.current);
    }
    setRoundKicks([
      { attempt: 1, scored: null, points: 0 },
      { attempt: 2, scored: null, points: 0 },
      { attempt: 3, scored: null, points: 0 },
      { attempt: 4, scored: null, points: 0 },
      { attempt: 5, scored: null, points: 0 }
    ]);
    setCurrentRoundIdx(0);
    setIsMatchOver(false);
    setRecentResult(null);
    setScore(0);
    setStreak(0);
    resetBallToSpot();
  };

  // Perform AI Tactical Call
  const performAiTacticalAnalysis = async (screenshot: string) => {
    const currentReqId = ++aiRequestIdRef.current;
    isAiThinkingRef.current = true;
    setIsAiThinking(true);

    const context = {
      round: currentRoundIdx + 1,
      maxRounds: roundKicks.length,
      score,
      streak,
      gkSkill: gkStateRef.current.skillLevel,
      gkTendency: gkStateRef.current.tendency,
      previousAttempts: roundKicks.slice(0, currentRoundIdx).map(k => ({ scored: k.scored, zone: k.zone })),
      availableBalls: Object.keys(BALL_SKINS) as BallSkin[],
      activeBall: activeBallRef.current,
      windMph: windSpeed
    };

    getPenaltyTactics(screenshot, context, gkStateRef.current).then(res => {
      // Only apply if this is still the active analysis request
      if (aiRequestIdRef.current === currentReqId) {
        setDebugInfo(res.debug);
        setAiHint(res.hint);
        isAiThinkingRef.current = false;
        setIsAiThinking(false);
      }
    }).catch(() => {
      if (aiRequestIdRef.current === currentReqId) {
        isAiThinkingRef.current = false;
        setIsAiThinking(false);
      }
    });
  };

  // Create Sparkles / Fire / Grass Particles
  const createBallParticles = (x: number, y: number, color: string, count: number = 4) => {
    for (let i = 0; i < count; i++) {
      particles.current.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 6,
        vy: (Math.random() - 0.5) * 6 + 1,
        size: Math.random() * 5 + 3,
        life: 1.0,
        color
      });
    }
  };

  // Kick execution with realistic ballistics (Never blocked by AI thinking)
  const executeKick = (targetGoalX: number, targetGoalY: number, powerRatio: number, spinValue: number = 0) => {
    if (isBallFlying.current || isMatchOver) return;

    isBallFlying.current = true;
    flightStartTime.current = performance.now();

    const skin = BALL_SKINS[activeBallRef.current];
    const power = Math.max(0.35, Math.min(powerRatio, 1.35));
    const speedMult = skin.id === 'fire' ? 1.25 : 1.0;
    const curveMult = skin.id === 'neon' ? 1.45 : 1.0;

    // Apply wind drift to targetX
    const finalTargetX = targetGoalX + (windSpeed * 3.5);
    const finalTargetY = targetGoalY;

    // Total flight duration frames (14 - 24 frames, ~350ms to 600ms)
    const totalFlightFrames = Math.max(22 - power * 8, 12) / speedMult;
    const vz = 1.0 / totalFlightFrames;
    const vx = (finalTargetX - penaltySpotRef.current.x) / totalFlightFrames;
    const vy = (finalTargetY - penaltySpotRef.current.y) / totalFlightFrames - (0.5 * 0.32 * totalFlightFrames);

    ballVel3D.current = { vx, vy, vz };
    ballSpin.current = spinValue * curveMult;

    soundEffects.playKick(0.7 + power * 0.3);

    // Trigger Goalkeeper Dive Reaction
    triggerGoalkeeperDive(finalTargetX, finalTargetY, power);
  };

  // Quick Direct Tap on Zone for Instant Strike
  const handleDirectTargetKick = (zone: GoalZone) => {
    if (isBallFlying.current || isMatchOver) return;
    const gb = goalBox.current;
    const thirdW = gb.width / 3;
    const halfH = gb.height / 2;

    let targetX = gb.x + gb.width / 2;
    let targetY = gb.y + gb.height * 0.45;
    let spin = 0;

    if (zone === 'top-left') {
      targetX = gb.x + thirdW * 0.35;
      targetY = gb.y + halfH * 0.35;
      spin = -0.3;
    } else if (zone === 'top-right') {
      targetX = gb.x + gb.width - thirdW * 0.35;
      targetY = gb.y + halfH * 0.35;
      spin = 0.3;
    } else if (zone === 'top-center') {
      targetX = gb.x + gb.width / 2;
      targetY = gb.y + halfH * 0.35;
      spin = 0;
    } else if (zone === 'bottom-left') {
      targetX = gb.x + thirdW * 0.35;
      targetY = gb.y + gb.height - halfH * 0.35;
      spin = -0.2;
    } else if (zone === 'bottom-right') {
      targetX = gb.x + gb.width - thirdW * 0.35;
      targetY = gb.y + gb.height - halfH * 0.35;
      spin = 0.2;
    } else if (zone === 'bottom-center') {
      targetX = gb.x + gb.width / 2;
      targetY = gb.y + gb.height - halfH * 0.35;
      spin = 0;
    }

    executeKick(targetX, targetY, 0.95, spin);
  };

  // Keyboard Shortcuts (1-6 for zones, Space to shoot)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isBallFlying.current || isMatchOver) return;
      if (e.key === '1' || e.key === 'q' || e.key === 'Q') handleDirectTargetKick('top-left');
      if (e.key === '2' || e.key === 'w' || e.key === 'W') handleDirectTargetKick('top-center');
      if (e.key === '3' || e.key === 'e' || e.key === 'E') handleDirectTargetKick('top-right');
      if (e.key === '4' || e.key === 'a' || e.key === 'A') handleDirectTargetKick('bottom-left');
      if (e.key === '5' || e.key === 's' || e.key === 'S') handleDirectTargetKick('bottom-center');
      if (e.key === '6' || e.key === 'd' || e.key === 'D') handleDirectTargetKick('bottom-right');
      if (e.key === ' ' || e.key === 'Enter') {
        if (aiHint.recommendedZone) handleDirectTargetKick(aiHint.recommendedZone);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [aiHint, isMatchOver]);

  // Check Shot Outcome
  const evaluateGoal = (finalX: number, finalY: number, speedKmh: number) => {
    const gb = goalBox.current;
    const gk = gkStateRef.current;
    const skin = BALL_SKINS[activeBallRef.current];

    // Goal Frame Bounds
    const goalLeft = gb.x;
    const goalRight = gb.x + gb.width;
    const goalTop = gb.y;
    const goalBottom = gb.y + gb.height;

    // Margin for post detection
    const postMargin = 18;
    const isHittingLeftPost = Math.abs(finalX - goalLeft) < postMargin && finalY >= goalTop && finalY <= goalBottom;
    const isHittingRightPost = Math.abs(finalX - goalRight) < postMargin && finalY >= goalTop && finalY <= goalBottom;
    const isHittingCrossbar = Math.abs(finalY - goalTop) < postMargin && finalX >= goalLeft && finalX <= goalRight;

    if (isHittingLeftPost || isHittingRightPost || isHittingCrossbar) {
      soundEffects.playPostHit();
      const res: ShotResult = {
        outcome: 'post',
        zone: 'post',
        speedKmh,
        points: Math.round(100 * skin.multiplier),
        spin: ballSpin.current,
        xG: 0.12,
        message: "OFF THE WOODWORK! Struck the frame!"
      };
      finishShot(res);
      return;
    }

    // Check if inside Goal
    const isInsideGoal = finalX > goalLeft + 15 && finalX < goalRight - 15 && finalY > goalTop + 15 && finalY < goalBottom;

    if (!isInsideGoal) {
      soundEffects.playCrowdGroan();
      const res: ShotResult = {
        outcome: 'miss',
        zone: 'miss',
        speedKmh,
        points: 0,
        spin: ballSpin.current,
        xG: 0.05,
        message: "OFF TARGET! Missed the goal frame."
      };
      finishShot(res);
      return;
    }

    // Determine Goal Zone
    let zone: GoalZone = 'bottom-center';
    let zoneBasePoints = 200;
    const thirdW = gb.width / 3;
    const halfH = gb.height / 2;

    const isLeftThird = finalX < goalLeft + thirdW;
    const isRightThird = finalX > goalRight - thirdW;
    const isTopHalf = finalY < goalTop + halfH;

    if (isTopHalf) {
      if (isLeftThird) {
        zone = 'top-left';
        zoneBasePoints = 500;
      } else if (isRightThird) {
        zone = 'top-right';
        zoneBasePoints = 500;
      } else {
        zone = 'top-center';
        zoneBasePoints = 350;
      }
    } else {
      if (isLeftThird) {
        zone = 'bottom-left';
        zoneBasePoints = 300;
      } else if (isRightThird) {
        zone = 'bottom-right';
        zoneBasePoints = 300;
      } else {
        zone = 'bottom-center';
        zoneBasePoints = 200;
      }
    }

    // Goalkeeper Save Detection
    const gkFinalX = gk.x;
    const gkFinalY = gk.y;
    const gkReach = 90 * gk.armExtension;

    const distToGk = Math.hypot(finalX - gkFinalX, finalY - gkFinalY);

    // Fast shots reduce GK reach; upper corners are hardest for goalkeeper
    const difficultyFactor = (zone === 'top-left' || zone === 'top-right') ? 0.62 : 1.0;
    const speedDifficultyReduction = Math.min(speedKmh / 130, 0.45);
    const effectiveSaveRadius = gkReach * difficultyFactor * (1 - speedDifficultyReduction) * gk.skillLevel;

    const isSaved = distToGk < effectiveSaveRadius;

    if (isSaved) {
      gk.state = 'saved';
      soundEffects.playSave();
      const res: ShotResult = {
        outcome: 'saved',
        zone,
        speedKmh,
        points: 0,
        spin: ballSpin.current,
        xG: 0.45,
        message: "SPECTACULAR SAVE by the Goalkeeper!"
      };
      finishShot(res);
    } else {
      gk.state = 'beaten';
      soundEffects.playGoal();
      triggerNetRipple(finalX, finalY);

      // Fire celebration confetti
      try {
        confetti({
          particleCount: zone.includes('top') ? 95 : 65,
          spread: 85,
          origin: { y: 0.6 }
        });
      } catch (e) {}

      const pointsEarned = Math.round(zoneBasePoints * skin.multiplier);
      const isTopBins = zone === 'top-left' || zone === 'top-right';

      const res: ShotResult = {
        outcome: 'goal',
        zone,
        speedKmh,
        points: pointsEarned,
        spin: ballSpin.current,
        xG: isTopBins ? 0.95 : 0.78,
        message: isTopBins ? "WHAT A GOLAZO! Absolute Top Bins!" : "GOOOAL! Beautifully struck penalty!"
      };
      finishShot(res);
    }
  };

  const finishShot = (result: ShotResult) => {
    lastShotResult.current = result;
    setRecentResult(result);

    // Auto-remove outcome card after 2.8s so it never lingers permanently
    if (resultBannerTimerRef.current) {
      clearTimeout(resultBannerTimerRef.current);
    }
    resultBannerTimerRef.current = setTimeout(() => {
      setRecentResult(null);
    }, 2800);

    if (result.outcome === 'goal') {
      setScore(prev => prev + result.points);
      setStreak(prev => {
        const next = prev + 1;
        setBestStreak(b => Math.max(b, next));
        return next;
      });
    } else {
      setStreak(0);
    }

    setLastSpeed(result.speedKmh);
    setBestSpeed(prev => Math.max(prev, result.speedKmh));

    // Update Round Indicator
    setRoundKicks(prev => {
      const copy = [...prev];
      if (copy[currentRoundIdx]) {
        copy[currentRoundIdx] = {
          attempt: currentRoundIdx + 1,
          scored: result.outcome === 'goal',
          points: result.points,
          speedKmh: result.speedKmh,
          zone: result.zone
        };
      }
      return copy;
    });

    // Advance round or finish match
    setTimeout(() => {
      if (currentRoundIdx + 1 >= roundKicks.length) {
        setIsMatchOver(true);
      } else {
        setCurrentRoundIdx(prev => prev + 1);
        resetBallToSpot();
      }
    }, 2400);
  };

  // Start Goalkeeper Dive
  const triggerGoalkeeperDive = (targetX: number, targetY: number, power: number) => {
    const gk = gkStateRef.current;
    const gb = goalBox.current;
    const midX = gb.x + gb.width / 2;
    const midY = gb.y + gb.height / 2;

    const correctGuess = Math.random() < gk.skillLevel;
    let diveTargetX = midX;
    let diveTargetY = midY;

    if (correctGuess) {
      const error = (1 - gk.skillLevel) * 75 * (Math.random() - 0.5);
      diveTargetX = Math.max(gb.x + 30, Math.min(gb.x + gb.width - 30, targetX + error));
      diveTargetY = Math.max(gb.y + 30, Math.min(gb.y + gb.height - 20, targetY + error));
    } else {
      const wrongSides = [-1, 1];
      const side = wrongSides[Math.floor(Math.random() * wrongSides.length)];
      diveTargetX = midX + side * (gb.width * 0.38);
      diveTargetY = Math.random() > 0.5 ? gb.y + 60 : gb.y + gb.height - 40;
    }

    let direction: GoalkeeperState['diveDirection'] = 'center';
    if (diveTargetX < midX - 50) {
      direction = diveTargetY < midY ? 'top-left' : 'bottom-left';
    } else if (diveTargetX > midX + 50) {
      direction = diveTargetY < midY ? 'top-right' : 'bottom-right';
    } else {
      direction = 'center';
    }

    gk.diveDirection = direction;
    gk.state = 'diving';
    gk.diveProgress = 0;
  };

  // --- Main Canvas Loop & Hand Tracking ---
  useEffect(() => {
    if (!videoRef.current || !canvasRef.current || !containerRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;

    const updateGoalDimensions = () => {
      const goalW = Math.min(canvas.width * 0.74, 820);
      const goalH = Math.min(canvas.height * 0.44, 380);
      const goalX = (canvas.width - goalW) / 2;
      const goalY = Math.max(canvas.height * 0.12, 50);

      goalBox.current = {
        x: goalX,
        y: goalY,
        width: goalW,
        height: goalH,
        depth: 70
      };

      penaltySpotRef.current = {
        x: canvas.width / 2,
        y: canvas.height - 130
      };

      initNetGrid(goalBox.current);

      if (!isBallFlying.current && !isPinching.current && !isDraggingMouse.current) {
        ball3D.current = {
          x: penaltySpotRef.current.x,
          y: penaltySpotRef.current.y,
          z: 0
        };
      }
    };

    updateGoalDimensions();

    let camera: any = null;
    let hands: any = null;
    let animId: number | null = null;
    let isDisposed = false;
    let isFrameBusy = false;

    const onResults = (results: any) => {
      if (isDisposed) return;
      setLoading(false);

      if (canvas.width !== container.clientWidth || canvas.height !== container.clientHeight) {
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
        updateGoalDimensions();
      }

      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // 1. Draw Stadium Pitch & Floodlights
      drawStadium(ctx, canvas.width, canvas.height);

      // 2. Draw Webcam Feed Overlay (Subtle in background or corner)
      if (useCamera && results.image) {
        ctx.save();
        ctx.globalAlpha = 0.12;
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
        ctx.restore();
      }

      // 3. Process MediaPipe Hand Tracking with Exponential Smoothing
      let rawHandPos: Point | null = null;
      let pinchDist = 1.0;
      let isPinchingNow = false;

      if (useCamera && results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        setHandDetected(true);
        const landmarks = results.multiHandLandmarks[0];
        handLandmarksRef.current = landmarks;

        const idxTip = landmarks[8];
        const thumbTip = landmarks[4];
        const wrist = landmarks[0];

        const rawX = (1 - (idxTip.x + thumbTip.x) / 2) * canvas.width;
        const rawY = ((idxTip.y + thumbTip.y) / 2) * canvas.height;
        rawHandPos = { x: rawX, y: rawY };

        // Exponential moving average for smooth hand motion
        if (!smoothedHandPos.current) {
          smoothedHandPos.current = rawHandPos;
        } else {
          smoothedHandPos.current.x += (rawHandPos.x - smoothedHandPos.current.x) * 0.45;
          smoothedHandPos.current.y += (rawHandPos.y - smoothedHandPos.current.y) * 0.45;
        }

        const dx = idxTip.x - thumbTip.x;
        const dy = idxTip.y - thumbTip.y;
        pinchDist = Math.sqrt(dx * dx + dy * dy);
        isPinchingNow = pinchDist < PINCH_THRESHOLD;
        handPinchConfidence.current = Math.max(0, Math.min(1, 1 - pinchDist / PINCH_THRESHOLD));

        // Draw Stylized Hand Skeleton if enabled
        if (showSkeletonRef.current) {
          drawHandSkeleton(ctx, landmarks, canvas.width, canvas.height, isPinchingNow);
        }

        // Draw Hand Cursor / Reticle
        const handPos = smoothedHandPos.current;
        if (handPos) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(handPos.x, handPos.y, isPinchingNow ? 22 : 15, 0, Math.PI * 2);
          ctx.strokeStyle = isPinchingNow ? '#00e676' : '#00e5ff';
          ctx.lineWidth = 3;
          ctx.shadowColor = isPinchingNow ? '#00e676' : '#00e5ff';
          ctx.shadowBlur = 12;
          ctx.stroke();

          ctx.fillStyle = isPinchingNow ? 'rgba(0, 230, 118, 0.35)' : 'rgba(0, 229, 255, 0.2)';
          ctx.fill();

          // Hand Label
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 10px Rajdhani, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(isPinchingNow ? 'PINCH ACTIVE' : 'OPEN HAND', handPos.x, handPos.y - 20);
          ctx.restore();
        }

        handStateLabel.current = isPinchingNow ? 'Aiming / Pinching' : 'Open Hand';
        setHandTrackingInfo({
          state: isPinchingNow ? 'Pinching Ball' : 'Tracking Hand',
          confidence: Math.round(85 + (isPinchingNow ? 15 : 0))
        });
      } else {
        setHandDetected(false);
        handLandmarksRef.current = null;
        smoothedHandPos.current = null;
        handStateLabel.current = 'Searching...';
      }

      // --- Slingshot / Flick Shooting Mechanics (Camera + Mouse) ---
      const penaltyPos = penaltySpotRef.current;
      const handPos = smoothedHandPos.current;

      // Handle Hand Pinch Input
      if (useCamera && handPos && isPinchingNow && !isBallFlying.current && !isMatchOver) {
        const distToBall = Math.hypot(handPos.x - ball3D.current.x, handPos.y - ball3D.current.y);
        
        if (!isPinching.current && distToBall < 120) {
          isPinching.current = true;
          dragStart.current = { x: penaltyPos.x, y: penaltyPos.y };
          dragPointsHistory.current = [{ x: handPos.x, y: handPos.y, time: performance.now() }];
          soundEffects.playKick(0.2);
        }

        if (isPinching.current) {
          dragCurrent.current = { x: handPos.x, y: handPos.y };
          dragPointsHistory.current.push({ x: handPos.x, y: handPos.y, time: performance.now() });
          if (dragPointsHistory.current.length > 8) dragPointsHistory.current.shift();

          const pullDx = handPos.x - penaltyPos.x;
          const pullDy = handPos.y - penaltyPos.y;
          const pullDist = Math.hypot(pullDx, pullDy);

          if (pullDist > MAX_DRAG_DIST) {
            const angle = Math.atan2(pullDy, pullDx);
            ball3D.current.x = penaltyPos.x + Math.cos(angle) * MAX_DRAG_DIST;
            ball3D.current.y = penaltyPos.y + Math.sin(angle) * MAX_DRAG_DIST;
          } else {
            ball3D.current.x = handPos.x;
            ball3D.current.y = handPos.y;
          }
        }
      } else if (isPinching.current && (!handPos || !isPinchingNow)) {
        // Hand Released -> Determine if Flick Forward or Pull Back Slingshot!
        isPinching.current = false;
        const pullDx = penaltyPos.x - ball3D.current.x;
        const pullDy = penaltyPos.y - ball3D.current.y;
        const stretch = Math.hypot(pullDx, pullDy);

        // Check if user pulled backward (pullDy < 0 means dragged down below penalty spot)
        if (ball3D.current.y > penaltyPos.y + 25) {
          // Slingshot mode
          const targetX = goalBox.current.x + goalBox.current.width / 2 + (pullDx * 3.2);
          const targetY = goalBox.current.y + goalBox.current.height * 0.45 + (pullDy * 2.8);
          const powerRatio = Math.min(stretch / MAX_DRAG_DIST, 1.0);
          executeKick(targetX, targetY, powerRatio, (pullDx / MAX_DRAG_DIST) * 0.45);
        } else if (ball3D.current.y < penaltyPos.y - 25) {
          // Flick forward mode
          const targetX = ball3D.current.x;
          const targetY = Math.max(goalBox.current.y + 30, ball3D.current.y - 200);
          executeKick(targetX, targetY, 0.95, (ball3D.current.x - penaltyPos.x) * 0.003);
        } else {
          ball3D.current.x = penaltyPos.x;
          ball3D.current.y = penaltyPos.y;
        }
      }

      // Mouse drag smoothly updates ball position
      if (isDraggingMouse.current && !isBallFlying.current) {
        const pullDx = dragCurrent.current.x - penaltyPos.x;
        const pullDy = dragCurrent.current.y - penaltyPos.y;
        const pullDist = Math.hypot(pullDx, pullDy);

        if (pullDist > MAX_DRAG_DIST) {
          const angle = Math.atan2(pullDy, pullDx);
          ball3D.current.x = penaltyPos.x + Math.cos(angle) * MAX_DRAG_DIST;
          ball3D.current.y = penaltyPos.y + Math.sin(angle) * MAX_DRAG_DIST;
        } else {
          ball3D.current.x = dragCurrent.current.x;
          ball3D.current.y = dragCurrent.current.y;
        }
      } else if (!isBallFlying.current && !isPinching.current && !isDraggingMouse.current) {
        // Ease back to spot
        ball3D.current.x += (penaltyPos.x - ball3D.current.x) * 0.22;
        ball3D.current.y += (penaltyPos.y - ball3D.current.y) * 0.22;
      }

      // 4. 3D Flight Physics
      if (isBallFlying.current) {
        const b = ball3D.current;
        const v = ballVel3D.current;

        // Advance 3D trajectory towards goal line (z: 0 -> 1.0)
        b.z += v.vz;
        b.x += v.vx + Math.sin(ballSpin.current) * (1 - b.z) * 3.5;
        b.y += v.vy;

        // Gravity effect
        v.vy += 0.32 * (1 - b.z);
        ballRotation.current += ballSpin.current + 0.16;

        // Particle Trail based on skin
        const skinConfig = BALL_SKINS[activeBallRef.current];
        createBallParticles(b.x, b.y, skinConfig.trailColor, 2);

        // Update Goalkeeper AI dive
        updateGoalkeeperPhysics(b.x, b.y, b.z);

        // Check Goal Arrival
        if (b.z >= 1.0) {
          isBallFlying.current = false;
          b.z = 1.0;
          
          const initialSpeed = Math.hypot(v.vx, v.vy) * 22;
          const skinMult = skinConfig.id === 'fire' ? 1.2 : 1.0;
          const speedKmh = Math.min(Math.round(initialSpeed * skinMult + 62), 136);

          evaluateGoal(b.x, b.y, speedKmh);
        }
      }

      // 5. Update Dynamic Net Physics Ripple
      updateNetRipple();

      // 6. Draw Goal Structure & Dynamic Ripple Net
      drawGoal(ctx, goalBox.current);

      // 7. Draw Target Zones & AI Tactical Reticle
      drawTargetZones(ctx, goalBox.current);

      // 8. Draw Goalkeeper
      drawGoalkeeper(ctx, gkStateRef.current, goalBox.current);

      // 9. Draw Slingshot Bands & 3D Soccer Ball
      drawSlingshotAndBall(ctx, ball3D.current, penaltySpotRef.current, activeBallRef.current);

      // 10. Draw Particles
      drawParticles(ctx);

      ctx.restore();

      // Gemini AI Vision Screen Capture
      if (captureRequestRef.current) {
        captureRequestRef.current = false;
        const offscreen = document.createElement('canvas');
        const targetWidth = 480;
        const scale = Math.min(1, targetWidth / canvas.width);
        offscreen.width = canvas.width * scale;
        offscreen.height = canvas.height * scale;
        const oCtx = offscreen.getContext('2d');
        if (oCtx) {
          oCtx.drawImage(canvas, 0, 0, offscreen.width, offscreen.height);
          const screenshot = offscreen.toDataURL("image/jpeg", 0.65);
          setTimeout(() => performAiTacticalAnalysis(screenshot), 0);
        }
      }
    };

    // Goalkeeper Animation Physics
    const updateGoalkeeperPhysics = (targetX: number, targetY: number, ballZ: number) => {
      const gk = gkStateRef.current;
      const gb = goalBox.current;
      const midX = gb.x + gb.width / 2;
      const groundY = gb.y + gb.height - 30;

      if (gk.state === 'diving') {
        gk.diveProgress = Math.min(gk.diveProgress + 0.058, 1.0);
        const t = gk.diveProgress;

        let targetDiveX = midX;
        let targetDiveY = groundY;
        let tilt = 0;

        switch (gk.diveDirection) {
          case 'top-left':
            targetDiveX = gb.x + 80;
            targetDiveY = gb.y + 80;
            tilt = -Math.PI / 3.2;
            break;
          case 'bottom-left':
            targetDiveX = gb.x + 90;
            targetDiveY = groundY;
            tilt = -Math.PI / 2.6;
            break;
          case 'top-right':
            targetDiveX = gb.x + gb.width - 80;
            targetDiveY = gb.y + 80;
            tilt = Math.PI / 3.2;
            break;
          case 'bottom-right':
            targetDiveX = gb.x + gb.width - 90;
            targetDiveY = groundY;
            tilt = Math.PI / 2.6;
            break;
          case 'center':
          default:
            targetDiveX = midX;
            targetDiveY = gb.y + gb.height * 0.45;
            tilt = 0;
            break;
        }

        gk.x += (targetDiveX - gk.x) * 0.19;
        gk.y += (targetDiveY - gk.y) * 0.19;
        gk.bodyTilt += (tilt - gk.bodyTilt) * 0.22;
        gk.armExtension = 1 + t * 0.4;
      }
    };

    // Update Net Ripple Mesh
    const updateNetRipple = () => {
      if (!netRippleActive.current) return;
      const grid = netGrid.current;
      let hasMovement = false;

      for (let r = 0; r < grid.length; r++) {
        for (let c = 0; c < grid[r].length; c++) {
          const node = grid[r][c];
          if (Math.abs(node.z) > 0.1 || Math.abs(node.vz) > 0.1) {
            hasMovement = true;
            const spring = -node.z * 0.12;
            node.vz += spring;
            node.vz *= 0.88; // damping
            node.z += node.vz;
          } else {
            node.z = 0;
            node.vz = 0;
          }
        }
      }

      if (!hasMovement) netRippleActive.current = false;
    };

    // Initialize MediaPipe Hands if Camera is enabled
    if (useCamera && window.Hands) {
      hands = new window.Hands({
        locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
      });
      hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      hands.onResults(onResults);

      if (window.Camera) {
        camera = new window.Camera(video, {
          onFrame: async () => {
            if (isDisposed || !videoRef.current || !hands) return;
            const v = videoRef.current;
            if (v.readyState < 2 || v.videoWidth === 0 || v.videoHeight === 0) return;
            if (isFrameBusy) return;
            isFrameBusy = true;
            try {
              if (!isDisposed && hands) {
                await hands.send({ image: v });
              }
            } catch (err: any) {
              const msg = err?.message || String(err);
              if (!msg.includes('deleted object') && !msg.includes('SolutionWasm')) {
                console.warn("Hand tracking frame processing error:", err);
              }
            } finally {
              isFrameBusy = false;
            }
          },
          width: 1280,
          height: 720,
        });
        camera.start();
      }
    } else {
      setLoading(false);
      const renderLoop = () => {
        if (isDisposed) return;
        onResults({ image: null });
        animId = requestAnimationFrame(renderLoop);
      };
      animId = requestAnimationFrame(renderLoop);
    }

    return () => {
      isDisposed = true;
      if (animId) {
        cancelAnimationFrame(animId);
      }
      if (camera) {
        try {
          camera.stop();
        } catch (e) {
          // ignore
        }
        camera = null;
      }
      if (hands) {
        const h = hands;
        hands = null;
        setTimeout(() => {
          try {
            h.close();
          } catch (e) {
            // ignore already deleted object
          }
        }, 150);
      }
    };
  }, [useCamera, initNetGrid]);

  // Initial Setup
  useEffect(() => {
    resetBallToSpot();
  }, [resetBallToSpot]);

  // --- Mouse / Touch Drag Event Handlers ---
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isBallFlying.current || isMatchOver) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const distToBall = Math.hypot(x - ball3D.current.x, y - ball3D.current.y);
    if (distToBall < 110) {
      isDraggingMouse.current = true;
      dragStart.current = { x, y };
      dragCurrent.current = { x, y };
      dragPointsHistory.current = [{ x, y, time: performance.now() }];
      soundEffects.playKick(0.2);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDraggingMouse.current || isBallFlying.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    dragCurrent.current = { x, y };
    dragPointsHistory.current.push({ x, y, time: performance.now() });
    if (dragPointsHistory.current.length > 8) dragPointsHistory.current.shift();
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (isBallFlying.current || isMatchOver) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const touch = e.touches[0];
    if (!touch) return;
    const rect = canvas.getBoundingClientRect();
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;

    const distToBall = Math.hypot(x - ball3D.current.x, y - ball3D.current.y);
    if (distToBall < 120) {
      isDraggingMouse.current = true;
      dragStart.current = { x, y };
      dragCurrent.current = { x, y };
      dragPointsHistory.current = [{ x, y, time: performance.now() }];
      soundEffects.playKick(0.2);
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDraggingMouse.current || isBallFlying.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const touch = e.touches[0];
    if (!touch) return;
    const rect = canvas.getBoundingClientRect();
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;

    dragCurrent.current = { x, y };
    dragPointsHistory.current.push({ x, y, time: performance.now() });
    if (dragPointsHistory.current.length > 8) dragPointsHistory.current.shift();
  };

  const handleTouchEnd = () => {
    handleMouseUp();
  };

  const handleMouseUp = () => {
    if (!isDraggingMouse.current || isBallFlying.current) return;
    isDraggingMouse.current = false;
    const penaltyPos = penaltySpotRef.current;
    const current = dragCurrent.current;

    // Check if user dragged backward (slingshot) or flicked upward (swipe)
    const pullDx = penaltyPos.x - current.x;
    const pullDy = penaltyPos.y - current.y;
    const stretch = Math.hypot(pullDx, pullDy);

    if (current.y > penaltyPos.y + 20 && stretch > 25) {
      // Slingshot release
      const targetX = goalBox.current.x + goalBox.current.width / 2 + (pullDx * 3.2);
      const targetY = goalBox.current.y + goalBox.current.height * 0.45 + (pullDy * 2.8);
      const powerRatio = Math.min(stretch / MAX_DRAG_DIST, 1.0);
      executeKick(targetX, targetY, powerRatio, (pullDx / MAX_DRAG_DIST) * 0.45);
    } else if (current.y < penaltyPos.y - 20) {
      // Flick / Swipe release forward towards goal
      const targetX = current.x;
      const targetY = Math.max(goalBox.current.y + 30, current.y);
      const powerRatio = Math.min(Math.abs(pullDy) / 120, 1.15);
      const spin = (current.x - penaltyPos.x) * 0.003;
      executeKick(targetX, targetY, powerRatio, spin);
    } else {
      ball3D.current.x = penaltyPos.x;
      ball3D.current.y = penaltyPos.y;
    }
  };

  // --- Rendering Functions ---

  // 1. Stadium Grass & Floodlights
  const drawStadium = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    const skyGrad = ctx.createLinearGradient(0, 0, 0, height * 0.45);
    skyGrad.addColorStop(0, '#06100c');
    skyGrad.addColorStop(0.6, '#0d2319');
    skyGrad.addColorStop(1, '#133526');

    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, width, height * 0.45);

    // Floodlight Beams
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const leftLight = ctx.createRadialGradient(width * 0.15, 20, 10, width * 0.15, 120, width * 0.45);
    leftLight.addColorStop(0, 'rgba(255, 255, 240, 0.35)');
    leftLight.addColorStop(1, 'rgba(255, 255, 240, 0)');
    ctx.fillStyle = leftLight;
    ctx.fillRect(0, 0, width * 0.5, height * 0.5);

    const rightLight = ctx.createRadialGradient(width * 0.85, 20, 10, width * 0.85, 120, width * 0.45);
    rightLight.addColorStop(0, 'rgba(255, 255, 240, 0.35)');
    rightLight.addColorStop(1, 'rgba(255, 255, 240, 0)');
    ctx.fillStyle = rightLight;
    ctx.fillRect(width * 0.5, 0, width * 0.5, height * 0.5);
    ctx.restore();

    // Stadium Crowd Silhouette
    ctx.fillStyle = '#0a1a13';
    ctx.beginPath();
    ctx.moveTo(0, height * 0.38);
    for (let i = 0; i < width; i += 20) {
      const h = Math.sin(i * 0.05) * 8 + Math.random() * 4;
      ctx.lineTo(i, height * 0.36 - h);
    }
    ctx.lineTo(width, height * 0.38);
    ctx.lineTo(width, height * 0.45);
    ctx.lineTo(0, height * 0.45);
    ctx.fill();

    // Grass Turf Perspective
    const pitchTop = height * 0.42;
    const pitchGrad = ctx.createLinearGradient(0, pitchTop, 0, height);
    pitchGrad.addColorStop(0, '#195b36');
    pitchGrad.addColorStop(0.5, '#1e6f42');
    pitchGrad.addColorStop(1, '#258b52');

    ctx.fillStyle = pitchGrad;
    ctx.fillRect(0, pitchTop, width, height - pitchTop);

    // Mowing Strip Patterns
    const numStripes = 9;
    for (let s = 0; s < numStripes; s++) {
      if (s % 2 === 0) {
        const y1 = pitchTop + Math.pow(s / numStripes, 1.8) * (height - pitchTop);
        const y2 = pitchTop + Math.pow((s + 1) / numStripes, 1.8) * (height - pitchTop);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
        ctx.fillRect(0, y1, width, y2 - y1);
      }
    }

    // Penalty Area Lines
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.lineWidth = 3;

    const gb = goalBox.current;
    const goalLineY = gb.y + gb.height;

    // Goal Line
    ctx.beginPath();
    ctx.moveTo(gb.x - 120, goalLineY);
    ctx.lineTo(gb.x + gb.width + 120, goalLineY);
    ctx.stroke();

    // 6-Yard Box
    ctx.strokeRect(gb.x - 40, goalLineY, gb.width + 80, 50);

    // Penalty Spot
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(penaltySpotRef.current.x, penaltySpotRef.current.y, 6, 0, Math.PI * 2);
    ctx.fill();

    // Penalty Arc
    ctx.beginPath();
    ctx.arc(penaltySpotRef.current.x, penaltySpotRef.current.y, 75, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();

    ctx.restore();
  };

  // 2. Goal Post & Dynamic Ripple Net
  const drawGoal = (ctx: CanvasRenderingContext2D, gb: { x: number; y: number; width: number; height: number; depth: number }) => {
    ctx.save();

    // Net Back Wall
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(gb.x, gb.y, gb.width, gb.height);

    // Draw Dynamic Net Grid with ripple deformation
    const grid = netGrid.current;
    if (grid && grid.length > 0) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
      ctx.lineWidth = 1.2;

      // Horizontal lines
      for (let r = 0; r < grid.length; r++) {
        ctx.beginPath();
        for (let c = 0; c < grid[r].length; c++) {
          const node = grid[r][c];
          const px = node.x;
          const py = node.y + node.z * 0.4;
          if (c === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }

      // Vertical lines
      for (let c = 0; c < grid[0].length; c++) {
        ctx.beginPath();
        for (let r = 0; r < grid.length; r++) {
          const node = grid[r][c];
          const px = node.x;
          const py = node.y + node.z * 0.4;
          if (r === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    }

    // Heavy Goal Posts & Crossbar
    ctx.lineWidth = 12;
    ctx.strokeStyle = '#f5f5f5';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = 12;

    ctx.beginPath();
    ctx.moveTo(gb.x, gb.y + gb.height);
    ctx.lineTo(gb.x, gb.y);
    ctx.lineTo(gb.x + gb.width, gb.y);
    ctx.lineTo(gb.x + gb.width, gb.y + gb.height);
    ctx.stroke();

    // Specular Highlight
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(gb.x - 2, gb.y + gb.height);
    ctx.lineTo(gb.x - 2, gb.y - 2);
    ctx.lineTo(gb.x + gb.width + 2, gb.y - 2);
    ctx.lineTo(gb.x + gb.width + 2, gb.y + gb.height);
    ctx.stroke();

    ctx.restore();
  };

  // 3. Goal Target Zones & AI Tactical Reticle
  const drawTargetZones = (ctx: CanvasRenderingContext2D, gb: { x: number; y: number; width: number; height: number }) => {
    const thirdW = gb.width / 3;
    const halfH = gb.height / 2;

    const targets: PenaltyTarget[] = [
      { id: 'top-left', label: 'TOP BINS 500', points: 500, x: gb.x + 15, y: gb.y + 15, width: thirdW - 25, height: halfH - 20, difficulty: 'Extreme', description: 'Upper 90 Corner' },
      { id: 'top-right', label: 'TOP BINS 500', points: 500, x: gb.x + gb.width - thirdW + 10, y: gb.y + 15, width: thirdW - 25, height: halfH - 20, difficulty: 'Extreme', description: 'Upper 90 Corner' },
      { id: 'top-center', label: 'ROOF 350', points: 350, x: gb.x + thirdW + 10, y: gb.y + 15, width: thirdW - 20, height: halfH - 20, difficulty: 'Hard', description: 'Roof of the Net' },
      { id: 'bottom-left', label: 'LOW CORNER 300', points: 300, x: gb.x + 15, y: gb.y + halfH + 10, width: thirdW - 25, height: halfH - 25, difficulty: 'Medium', description: 'Bottom Side Pocket' },
      { id: 'bottom-right', label: 'LOW CORNER 300', points: 300, x: gb.x + gb.width - thirdW + 10, y: gb.y + halfH + 10, width: thirdW - 25, height: halfH - 25, difficulty: 'Medium', description: 'Bottom Side Pocket' },
      { id: 'bottom-center', label: 'PANENKA 200', points: 200, x: gb.x + thirdW + 10, y: gb.y + halfH + 10, width: thirdW - 20, height: halfH - 25, difficulty: 'Easy', description: 'Low Center Chip' }
    ];

    targets.forEach(t => {
      const isRecommended = showAiReticle && aiHint.recommendedZone === t.id;

      ctx.save();
      if (isRecommended) {
        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = 3;
        ctx.fillStyle = 'rgba(0, 229, 255, 0.18)';
        ctx.shadowColor = '#00e5ff';
        ctx.shadowBlur = 16;
      } else {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
        ctx.lineWidth = 1.5;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
      }

      ctx.beginPath();
      ctx.roundRect(t.x, t.y, t.width, t.height, 8);
      ctx.fill();
      ctx.stroke();

      // Zone Points Badge
      ctx.fillStyle = isRecommended ? '#00e5ff' : 'rgba(255, 255, 255, 0.6)';
      ctx.font = 'bold 11px Rajdhani, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(t.label, t.x + t.width / 2, t.y + t.height / 2 + 4);

      if (isRecommended) {
        const time = performance.now() * 0.003;
        const pulseSize = 6 + Math.sin(time) * 3;
        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(t.x + t.width / 2, t.y + t.height / 2, 22 + pulseSize, 0, Math.PI * 2);
        ctx.stroke();

        // Laser Aim Guide from Penalty Spot to AI Target
        if (!isBallFlying.current) {
          ctx.beginPath();
          ctx.setLineDash([12, 8]);
          ctx.lineDashOffset = -performance.now() * 0.04;
          ctx.moveTo(penaltySpotRef.current.x, penaltySpotRef.current.y);
          ctx.lineTo(t.x + t.width / 2, t.y + t.height / 2);
          ctx.strokeStyle = 'rgba(0, 229, 255, 0.65)';
          ctx.lineWidth = 2.5;
          ctx.stroke();
        }
      }

      ctx.restore();
    });
  };

  // 4. Goalkeeper Rendering with Idle Animation
  const drawGoalkeeper = (ctx: CanvasRenderingContext2D, gk: GoalkeeperState, gb: { x: number; y: number; width: number; height: number }) => {
    ctx.save();
    
    // Idle bouncing when waiting
    gkIdleAnimTimer.current += 0.05;
    const idleBounce = gk.state === 'ready' ? Math.sin(gkIdleAnimTimer.current) * 3 : 0;

    ctx.translate(gk.x, gk.y + idleBounce);
    ctx.rotate(gk.bodyTilt);

    // Goalkeeper Shadow
    ctx.save();
    ctx.rotate(-gk.bodyTilt);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.beginPath();
    ctx.ellipse(0, 10 - idleBounce, 36, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Uniform Colors
    const kitColor = '#ccff00';
    const gloveColor = '#ff1744';
    const shortsColor = '#1e1e1e';

    // Legs
    ctx.fillStyle = '#f5cba7';
    ctx.fillRect(-16, -20, 10, 30);
    ctx.fillRect(6, -20, 10, 30);

    // Socks & Cleats
    ctx.fillStyle = kitColor;
    ctx.fillRect(-16, 0, 10, 16);
    ctx.fillRect(6, 0, 10, 16);
    ctx.fillStyle = '#000000';
    ctx.fillRect(-18, 14, 14, 8);
    ctx.fillRect(4, 14, 14, 8);

    // Shorts
    ctx.fillStyle = shortsColor;
    ctx.fillRect(-22, -35, 44, 22);

    // Jersey Torso
    ctx.fillStyle = kitColor;
    ctx.beginPath();
    ctx.roundRect(-24, -80, 48, 50, 6);
    ctx.fill();

    // Jersey #1
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 16px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('1', 0, -48);

    // Head
    ctx.fillStyle = '#f5cba7';
    ctx.beginPath();
    ctx.arc(0, -94, 14, 0, Math.PI * 2);
    ctx.fill();

    // Hair / Headband
    ctx.fillStyle = '#3e2723';
    ctx.beginPath();
    ctx.arc(0, -98, 14, Math.PI, Math.PI * 2);
    ctx.fill();

    // Arms & Big Goalie Gloves
    const armSpread = 32 * gk.armExtension;
    ctx.fillStyle = kitColor;

    // Left Arm
    ctx.save();
    ctx.translate(-22, -72);
    ctx.rotate(-0.4 * gk.armExtension);
    ctx.fillRect(-8, 0, 12, armSpread);
    ctx.fillStyle = gloveColor;
    ctx.beginPath();
    ctx.arc(-2, armSpread + 4, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Right Arm
    ctx.save();
    ctx.translate(22, -72);
    ctx.rotate(0.4 * gk.armExtension);
    ctx.fillRect(-4, 0, 12, armSpread);
    ctx.fillStyle = gloveColor;
    ctx.beginPath();
    ctx.arc(2, armSpread + 4, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.restore();
  };

  // 5. Draw Hand Tracking Skeleton
  const drawHandSkeleton = (ctx: CanvasRenderingContext2D, landmarks: any[], width: number, height: number, isPinch: boolean) => {
    if (!landmarks || landmarks.length === 0) return;

    // Connections between joints
    const connections = [
      [0, 1], [1, 2], [2, 3], [3, 4], // Thumb
      [0, 5], [5, 6], [6, 7], [7, 8], // Index
      [5, 9], [9, 10], [10, 11], [11, 12], // Middle
      [9, 13], [13, 14], [14, 15], [15, 16], // Ring
      [13, 17], [17, 18], [18, 19], [19, 20], // Pinky
      [0, 17] // Palm base
    ];

    ctx.save();
    ctx.strokeStyle = isPinch ? 'rgba(0, 230, 118, 0.45)' : 'rgba(0, 229, 255, 0.35)';
    ctx.lineWidth = 2.5;

    // Draw Bone lines
    connections.forEach(([p1, p2]) => {
      const pt1 = landmarks[p1];
      const pt2 = landmarks[p2];
      ctx.beginPath();
      ctx.moveTo((1 - pt1.x) * width, pt1.y * height);
      ctx.lineTo((1 - pt2.x) * width, pt2.y * height);
      ctx.stroke();
    });

    // Draw Joint Dots
    landmarks.forEach((pt, i) => {
      const px = (1 - pt.x) * width;
      const py = pt.y * height;
      ctx.beginPath();
      ctx.arc(px, py, i === 4 || i === 8 ? 5 : 3, 0, Math.PI * 2);
      ctx.fillStyle = (i === 4 || i === 8) 
        ? (isPinch ? '#00e676' : '#ffd600') 
        : '#00e5ff';
      ctx.fill();
    });

    ctx.restore();
  };

  // 6. Slingshot Elastic Bands & 3D Soccer Ball
  const drawSlingshotAndBall = (
    ctx: CanvasRenderingContext2D,
    ball: Point3D,
    penaltyPos: Point,
    skin: BallSkin
  ) => {
    const skinConfig = BALL_SKINS[skin];
    const isDragging = isPinching.current || isDraggingMouse.current;

    // Elastic Aim Bands when pulling back
    if (!isBallFlying.current && isDragging) {
      ctx.save();
      ctx.strokeStyle = '#ffd600';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.shadowColor = '#ffd600';
      ctx.shadowBlur = 10;

      // Left Band
      ctx.beginPath();
      ctx.moveTo(penaltyPos.x - 38, penaltyPos.y + 10);
      ctx.lineTo(ball.x, ball.y);
      ctx.stroke();

      // Right Band
      ctx.beginPath();
      ctx.moveTo(penaltyPos.x + 38, penaltyPos.y + 10);
      ctx.lineTo(ball.x, ball.y);
      ctx.stroke();

      // Trajectory Prediction Vector (Power Arc)
      const pullDx = penaltyPos.x - ball.x;
      const pullDy = penaltyPos.y - ball.y;
      const stretch = Math.hypot(pullDx, pullDy);
      const powerPct = Math.min(stretch / MAX_DRAG_DIST, 1.0);

      ctx.beginPath();
      ctx.setLineDash([8, 8]);
      ctx.moveTo(ball.x, ball.y);
      ctx.lineTo(penaltyPos.x + pullDx * 2.6, penaltyPos.y + pullDy * 2.6);
      ctx.strokeStyle = powerPct > 0.8 ? '#ff1744' : '#00e676';
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.restore();
    }

    // Ball 3D Depth Scaling
    const scale = 1 - ball.z * 0.62;
    const currentRadius = Math.max(BALL_BASE_RADIUS * scale, 12);

    // Ball Shadow on Pitch
    ctx.save();
    const shadowY = penaltyPos.y + (ball.y - penaltyPos.y) * 0.3 + 12;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.beginPath();
    ctx.ellipse(ball.x, shadowY, currentRadius * 0.9, currentRadius * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Realistic 3D Soccer Ball Shading
    ctx.save();
    ctx.translate(ball.x, ball.y);
    ctx.rotate(ballRotation.current);

    const ballGrad = ctx.createRadialGradient(
      -currentRadius * 0.35,
      -currentRadius * 0.35,
      currentRadius * 0.1,
      0,
      0,
      currentRadius
    );

    if (skin === 'gold') {
      ballGrad.addColorStop(0, '#fff9c4');
      ballGrad.addColorStop(0.3, '#ffd700');
      ballGrad.addColorStop(1, '#b78103');
    } else if (skin === 'fire') {
      ballGrad.addColorStop(0, '#ffe0b2');
      ballGrad.addColorStop(0.4, '#ff5722');
      ballGrad.addColorStop(1, '#bf360c');
    } else if (skin === 'neon') {
      ballGrad.addColorStop(0, '#e0f7fa');
      ballGrad.addColorStop(0.3, '#00e5ff');
      ballGrad.addColorStop(1, '#651fff');
    } else {
      ballGrad.addColorStop(0, '#ffffff');
      ballGrad.addColorStop(0.4, '#eeeeee');
      ballGrad.addColorStop(1, '#9e9e9e');
    }

    ctx.beginPath();
    ctx.arc(0, 0, currentRadius, 0, Math.PI * 2);
    ctx.fillStyle = ballGrad;
    ctx.fill();

    // Pentagon Pattern
    ctx.fillStyle = skin === 'gold' ? '#3e2723' : skin === 'neon' ? '#311b92' : '#111111';
    
    const pRad = currentRadius * 0.38;
    ctx.beginPath();
    for (let p = 0; p < 5; p++) {
      const angle = (p * Math.PI * 2) / 5 - Math.PI / 2;
      const px = Math.cos(angle) * pRad;
      const py = Math.sin(angle) * pRad;
      if (p === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();

    for (let p = 0; p < 5; p++) {
      const angle = (p * Math.PI * 2) / 5 - Math.PI / 2;
      const px = Math.cos(angle) * currentRadius * 0.85;
      const py = Math.sin(angle) * currentRadius * 0.85;
      ctx.beginPath();
      ctx.arc(px, py, currentRadius * 0.2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.restore();
  };

  // 7. Draw Particles
  const drawParticles = (ctx: CanvasRenderingContext2D) => {
    for (let i = particles.current.length - 1; i >= 0; i--) {
      const p = particles.current[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.035;

      if (p.life <= 0) {
        particles.current.splice(i, 1);
      } else {
        ctx.save();
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  };

  return (
    <div className="flex w-full h-screen bg-[#070e0a] overflow-hidden select-none font-sans text-[#e3e3e3]">
      
      {/* LEFT: Stadium Field & Goal Canvas */}
      <div ref={containerRef} className="flex-1 relative h-full overflow-hidden bg-black">
        <video ref={videoRef} className="absolute hidden" playsInline muted />
        <canvas 
          ref={canvasRef} 
          className="absolute inset-0 cursor-grab active:cursor-grabbing touch-none w-full h-full"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
        />

        {/* Camera Loading Overlay */}
        {loading && useCamera && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#070e0a] z-50 p-4">
            <div className="flex flex-col items-center text-center">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full border-4 border-t-[#00e5ff] border-r-[#00e5ff] border-b-transparent border-l-transparent animate-spin mb-3" />
              <p className="text-white text-base sm:text-lg font-bold">Initializing Stadium & Gesture Tracking...</p>
              <p className="text-xs text-gray-400 mt-1">Please allow camera access or use Touch/Mouse mode</p>
            </div>
          </div>
        )}

        {/* Top Match HUD (Responsive for Mobile & Desktop) */}
        <div className="absolute top-2.5 sm:top-4 left-2.5 sm:left-6 right-2.5 sm:right-6 flex items-center justify-between z-30 pointer-events-none gap-1.5 sm:gap-4">
          
          {/* Score & Streak Card */}
          <div className="bg-[#12221a]/95 backdrop-blur-md border border-[#1f3e2e] px-2.5 sm:px-4 py-1.5 sm:py-2.5 rounded-xl sm:rounded-2xl shadow-2xl flex items-center gap-2.5 sm:gap-4 pointer-events-auto">
            <div className="flex items-center gap-1.5 sm:gap-2.5">
              <div className="w-7 h-7 sm:w-9 sm:h-9 rounded-lg sm:rounded-xl bg-[#00e5ff]/15 flex items-center justify-center text-[#00e5ff]">
                <Trophy className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
              <div>
                <p className="text-[8px] sm:text-[9px] text-gray-400 font-bold uppercase tracking-wider">Score</p>
                <p className="text-sm sm:text-xl font-black text-white font-display leading-tight">{score.toLocaleString()}</p>
              </div>
            </div>

            <div className="h-6 sm:h-7 w-px bg-white/10" />

            <div className="flex items-center gap-1.5 sm:gap-2.5">
              <div className="w-7 h-7 sm:w-9 sm:h-9 rounded-lg sm:rounded-xl bg-[#ff9100]/15 flex items-center justify-center text-[#ff9100]">
                <Zap className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
              <div>
                <p className="text-[8px] sm:text-[9px] text-gray-400 font-bold uppercase tracking-wider">Streak</p>
                <p className="text-sm sm:text-xl font-black text-[#ff9100] font-display leading-tight">{streak} <span className="text-[9px] sm:text-[10px] text-gray-400 font-normal hidden xs:inline">({bestStreak})</span></p>
              </div>
            </div>
          </div>

          {/* Penalty Shootout Round Indicator */}
          <div className="bg-[#12221a]/95 backdrop-blur-md border border-[#1f3e2e] px-2 sm:px-3.5 py-1.5 sm:py-2.5 rounded-xl sm:rounded-2xl shadow-2xl flex items-center gap-1 sm:gap-2 pointer-events-auto">
            <span className="text-[10px] sm:text-[11px] font-bold text-gray-400 mr-0.5 sm:mr-1 uppercase hidden md:inline">Round:</span>
            {roundKicks.map((k, idx) => {
              const isCurrent = idx === currentRoundIdx && !isMatchOver;
              let dotColor = 'bg-gray-700/50 border-gray-600';
              let content = `${idx + 1}`;

              if (k.scored === true) {
                dotColor = 'bg-[#00e676] border-[#00e676] text-black font-black';
                content = '⚽';
              } else if (k.scored === false) {
                dotColor = 'bg-[#ff1744] border-[#ff1744] text-white font-black';
                content = '✕';
              } else if (isCurrent) {
                dotColor = 'bg-[#00e5ff] border-[#00e5ff] text-black font-black animate-pulse';
              }

              return (
                <div 
                  key={idx}
                  className={`w-5 h-5 sm:w-7 sm:h-7 rounded-full flex items-center justify-center text-[9px] sm:text-[11px] border transition-all ${dotColor} ${isCurrent ? 'ring-2 sm:ring-4 ring-[#00e5ff]/30 scale-105 sm:scale-110' : ''}`}
                >
                  {content}
                </div>
              );
            })}
          </div>

          {/* Quick Controls & Hamburger Button */}
          <div className="flex items-center gap-1.5 sm:gap-2 pointer-events-auto">
            
            {/* Audio Mute */}
            <button
              onClick={handleToggleMute}
              className="p-2 sm:p-2.5 rounded-xl bg-[#12221a]/90 border border-[#1f3e2e] text-gray-300 hover:text-white hover:bg-[#1f3e2e] transition shadow-lg"
              title={isMuted ? "Unmute Audio" : "Mute Audio"}
            >
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4 text-[#00e676]" />}
            </button>

            {/* Camera / Mouse Toggle */}
            <button
              onClick={() => setUseCamera(!useCamera)}
              className={`p-2 sm:p-2.5 rounded-xl border transition shadow-lg flex items-center gap-1.5 text-xs font-bold ${
                useCamera ? 'bg-[#00e5ff]/15 border-[#00e5ff] text-[#00e5ff]' : 'bg-[#12221a]/90 border-[#1f3e2e] text-gray-400'
              }`}
              title="Toggle Webcam Gesture / Mouse Mode"
            >
              <Camera className="w-4 h-4" />
              <span className="hidden sm:inline">{useCamera ? "Camera" : "Touch"}</span>
            </button>

            {/* Restart Match */}
            <button
              onClick={restartMatch}
              className="p-2 sm:p-2.5 rounded-xl bg-[#12221a]/90 border border-[#1f3e2e] text-gray-300 hover:text-white hover:bg-[#1f3e2e] transition shadow-lg hidden sm:flex"
              title="Restart Shootout"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            {/* Hamburger / Settings & Tactical Drawer Button */}
            <button
              onClick={() => setIsDrawerOpen(prev => !prev)}
              className={`p-2 sm:p-2.5 rounded-xl border transition shadow-lg flex items-center gap-1.5 relative ${
                isDrawerOpen 
                  ? 'bg-[#00e5ff] border-[#00e5ff] text-black font-black' 
                  : 'bg-[#12221a]/95 border-[#1f3e2e] text-white hover:bg-[#1f3e2e]'
              }`}
              title="Open Gemini Coach & Settings"
            >
              <Menu className="w-4 h-4" />
              <span className="hidden md:inline text-xs font-bold">Menu</span>
              {/* Tactical Indicator Dot */}
              {isAiThinking ? (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-[#00e5ff] animate-ping" />
              ) : (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-[#00e676]" />
              )}
            </button>
          </div>
        </div>

        {/* Live Camera Analysis & Gesture Status HUD (Top Left) */}
        {useCamera && (
          <div className="absolute top-14 sm:top-20 left-3 sm:left-6 z-30 pointer-events-none">
            <div className="bg-[#0e1c15]/90 backdrop-blur-md border border-[#1f3e2e] px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-lg sm:rounded-xl flex items-center gap-2 sm:gap-3 text-[11px] sm:text-xs">
              <div className="flex items-center gap-1.5">
                <div className={`w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full ${handDetected ? 'bg-[#00e676] animate-pulse' : 'bg-red-500'}`} />
                <span className="font-mono text-gray-300 font-bold">
                  {handDetected ? handTrackingInfo.state : 'Show hand'}
                </span>
              </div>
              {handDetected && (
                <>
                  <div className="h-3 w-px bg-white/10" />
                  <span className="text-[#00e5ff] font-mono text-[10px] sm:text-[11px] font-bold">
                    {handTrackingInfo.confidence}%
                  </span>
                </>
              )}
            </div>
          </div>
        )}

        {/* Wind Condition Badge */}
        <div className="absolute top-14 sm:top-20 right-3 sm:right-6 z-30 pointer-events-none">
          <div className="bg-[#0e1c15]/90 backdrop-blur-md border border-[#1f3e2e] px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg sm:rounded-xl flex items-center gap-1.5 sm:gap-2 text-[11px] sm:text-xs">
            <Wind className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-[#00e5ff]" />
            <span className="text-gray-300 font-bold">
              {Math.abs(windSpeed)} km/h {windSpeed > 0 ? '→' : '←'}
            </span>
          </div>
        </div>

        {/* Shot Speedometer Floating Badge */}
        {lastSpeed > 0 && (
          <div className="absolute top-24 sm:top-32 left-3 sm:left-6 z-30 pointer-events-none animate-bounce">
            <div className="bg-black/85 backdrop-blur-md border border-[#00e5ff]/50 px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-lg sm:rounded-xl flex items-center gap-1.5 sm:gap-2">
              <Gauge className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#00e5ff]" />
              <div>
                <p className="text-[8px] sm:text-[9px] text-gray-400 uppercase font-bold">Last Shot</p>
                <p className="text-xs sm:text-base font-black text-white font-display leading-tight">{lastSpeed} <span className="text-[10px] sm:text-[11px] text-[#00e5ff]">km/h</span></p>
              </div>
            </div>
          </div>
        )}

        {/* Quick Strike Target Zone Bar (Direct Tap Accessibility) */}
        <div className="absolute bottom-14 sm:bottom-20 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 sm:gap-2 bg-[#0d1c14]/95 backdrop-blur-md border border-[#1f3e2e] p-1 sm:p-1.5 rounded-xl sm:rounded-2xl shadow-2xl max-w-[96vw] overflow-x-auto no-scrollbar">
          <span className="text-[10px] font-bold text-gray-400 uppercase ml-2 mr-1 hidden md:inline">Tap Zone:</span>
          {([
            { id: 'top-left', short: 'TOP L', full: 'TOP L (500)' },
            { id: 'top-center', short: 'ROOF', full: 'ROOF (350)' },
            { id: 'top-right', short: 'TOP R', full: 'TOP R (500)' },
            { id: 'bottom-left', short: 'BOT L', full: 'LOW L (300)' },
            { id: 'bottom-center', short: 'CHIP', full: 'PANENKA (200)' },
            { id: 'bottom-right', short: 'BOT R', full: 'LOW R (300)' },
          ] as { id: GoalZone; short: string; full: string }[]).map(item => {
            const isRec = aiHint.recommendedZone === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleDirectTargetKick(item.id)}
                disabled={isBallFlying.current || isMatchOver}
                className={`px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-lg text-[10px] sm:text-[11px] font-bold transition flex items-center gap-1 whitespace-nowrap ${
                  isRec 
                    ? 'bg-[#00e5ff]/20 text-[#00e5ff] border border-[#00e5ff]/50 hover:bg-[#00e5ff]/30' 
                    : 'bg-[#14281e] text-gray-300 hover:bg-[#1f3e2e] hover:text-white border border-transparent'
                }`}
              >
                {isRec && <Sparkles className="w-3 h-3 text-[#00e5ff]" />}
                <span className="sm:hidden">{item.short}</span>
                <span className="hidden sm:inline">{item.full}</span>
              </button>
            );
          })}
        </div>

        {/* Ball Skin Selector (Bottom Floating HUD) */}
        <div className="absolute bottom-2 sm:bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 sm:gap-2 bg-[#0e1c15]/95 backdrop-blur-md border border-[#1f3e2e] p-1 sm:p-1.5 rounded-xl sm:rounded-2xl shadow-2xl max-w-[96vw] overflow-x-auto no-scrollbar">
          <span className="text-[10px] font-bold text-gray-400 uppercase ml-2 mr-1 hidden md:inline">Ball:</span>
          {(Object.keys(BALL_SKINS) as BallSkin[]).map(skinKey => {
            const config = BALL_SKINS[skinKey];
            const isSelected = activeBall === skinKey;

            return (
              <button
                key={skinKey}
                onClick={() => setActiveBall(skinKey)}
                className={`px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg sm:rounded-xl flex items-center gap-1 sm:gap-1.5 text-[11px] sm:text-xs font-bold transition-all whitespace-nowrap ${
                  isSelected 
                    ? 'bg-gradient-to-r from-[#00e5ff] to-[#00b0ff] text-black shadow-lg shadow-[#00e5ff]/20 scale-105' 
                    : 'bg-[#162a1f] text-gray-300 hover:bg-[#1f3c2c] hover:text-white'
                }`}
              >
                <span>{skinKey === 'classic' ? '⚽' : skinKey === 'gold' ? '🏆' : skinKey === 'fire' ? '🔥' : '⚡'}</span>
                <span>{config.name.split(' ')[0]}</span>
                <span className={`text-[9px] px-1 py-0.2 rounded font-mono ${isSelected ? 'bg-black/20 text-black' : 'bg-black/40 text-gray-400'}`}>
                  {config.multiplier}x
                </span>
              </button>
            );
          })}
        </div>

        {/* Recent Shot Outcome Banner (Auto-dismisses in 2.8s & non-intrusive) */}
        {recentResult && (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 z-40 animate-in fade-in slide-in-from-top-4 duration-300 pointer-events-auto max-w-md w-[92%] sm:w-auto">
            <div 
              onClick={() => {
                if (resultBannerTimerRef.current) clearTimeout(resultBannerTimerRef.current);
                setRecentResult(null);
              }}
              className={`px-5 py-3 rounded-2xl border shadow-2xl backdrop-blur-md cursor-pointer transition-transform hover:scale-[1.02] relative overflow-hidden ${
                recentResult.outcome === 'goal'
                  ? 'bg-[#0d2a1b]/95 border-[#00e676] text-white shadow-[#00e676]/25'
                  : recentResult.outcome === 'saved'
                  ? 'bg-[#2a1313]/95 border-[#ff1744] text-white shadow-[#ff1744]/25'
                  : 'bg-[#261f0a]/95 border-[#ff9100] text-white shadow-[#ff9100]/25'
              }`}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">
                    {recentResult.outcome === 'goal' ? '⚽' : recentResult.outcome === 'saved' ? '🧤' : '💥'}
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-black font-display tracking-wider uppercase leading-none">
                        {recentResult.outcome === 'goal' ? 'GOOOAL!' : recentResult.outcome === 'saved' ? 'SAVED!' : 'OFF THE POST!'}
                      </h3>
                      {recentResult.points > 0 && (
                        <span className="text-xs font-black px-1.5 py-0.5 rounded bg-[#00e676]/25 text-[#00e676] leading-none">
                          +{recentResult.points} pts
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-300 font-medium mt-0.5 leading-snug">
                      {recentResult.message}
                    </p>
                  </div>
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (resultBannerTimerRef.current) clearTimeout(resultBannerTimerRef.current);
                    setRecentResult(null);
                  }}
                  className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition"
                  title="Dismiss"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="mt-2 pt-1.5 border-t border-white/10 flex items-center justify-between text-[11px] font-bold text-gray-300">
                <span>Speed: <strong className="text-white">{recentResult.speedKmh} km/h</strong></span>
                <span>•</span>
                <span>Zone: <strong className="text-[#00e5ff]">{recentResult.zone.replace('-', ' ').toUpperCase()}</strong></span>
                <span>•</span>
                <span className="text-gray-400 text-[10px]">Tap to dismiss</span>
              </div>

              {/* 2.8s Auto-dismiss progress bar */}
              <div 
                className={`absolute bottom-0 left-0 h-1 ${
                  recentResult.outcome === 'goal' ? 'bg-[#00e676]' : recentResult.outcome === 'saved' ? 'bg-[#ff1744]' : 'bg-[#ff9100]'
                }`}
                style={{
                  animation: 'shrinkWidth 2.8s linear forwards',
                  width: '100%'
                }}
              />
            </div>
          </div>
        )}

        {/* Match Over Modal */}
        {isMatchOver && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-6 animate-in fade-in duration-300">
            <div className="bg-[#102018] border border-[#1f3e2e] p-8 rounded-3xl max-w-md w-full text-center shadow-2xl">
              <Trophy className="w-16 h-16 text-[#ffd700] mx-auto mb-4 animate-bounce" />
              <h2 className="text-3xl font-black font-display text-white mb-2 uppercase">Shootout Finished!</h2>
              
              <div className="my-6 p-4 rounded-2xl bg-[#0b1610] border border-[#1f3e2e] grid grid-cols-2 gap-4 text-left">
                <div>
                  <p className="text-xs text-gray-400 font-bold uppercase">Final Score</p>
                  <p className="text-2xl font-black text-[#00e5ff] font-display">{score.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 font-bold uppercase">Goals Scored</p>
                  <p className="text-2xl font-black text-[#00e676] font-display">
                    {roundKicks.filter(k => k.scored).length} / {roundKicks.length}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 font-bold uppercase">Best Shot Speed</p>
                  <p className="text-lg font-bold text-white">{bestSpeed} km/h</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 font-bold uppercase">Longest Streak</p>
                  <p className="text-lg font-bold text-[#ff9100]">{bestStreak}</p>
                </div>
              </div>

              <button
                onClick={restartMatch}
                className="w-full py-4 rounded-2xl bg-gradient-to-r from-[#00e5ff] to-[#00b0ff] text-black font-black text-lg uppercase tracking-wider hover:opacity-90 transition shadow-lg shadow-[#00e5ff]/25 flex items-center justify-center gap-2"
              >
                <RotateCcw className="w-5 h-5" /> Play Next Tournament
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Backdrop for Mobile Drawer */}
      {isDrawerOpen && (
        <div 
          onClick={() => setIsDrawerOpen(false)}
          className="fixed inset-0 bg-black/75 backdrop-blur-sm z-40 lg:hidden animate-in fade-in duration-200"
        />
      )}

      {/* RIGHT: Gemini Tactical Coach & Settings Drawer (Mobile Slide-Over & Desktop Sidebar) */}
      <div 
        className={`fixed inset-y-0 right-0 z-50 w-full sm:max-w-[400px] lg:static lg:translate-x-0 lg:w-[380px] bg-[#0c1711] border-l border-[#193224] flex flex-col h-full overflow-hidden shadow-2xl transition-transform duration-300 ease-out ${
          isDrawerOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'
        }`}
      >
        
        {/* Drawer Header with Title & Tabs */}
        <div className="border-b border-[#193224] bg-[#112219]">
          {/* Top Bar */}
          <div className="p-3.5 sm:p-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-[#00e5ff]/15 flex items-center justify-center text-[#00e5ff]">
                <BrainCircuit className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
              <div>
                <h2 className="font-bold text-sm tracking-wider uppercase text-white font-display leading-tight">
                  Tactical Coach & Settings
                </h2>
                <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
                  {isAiThinking ? (
                    <span className="text-[#00e5ff] flex items-center gap-1 font-mono">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#00e5ff] animate-ping inline-block" /> Scouting match...
                    </span>
                  ) : (
                    <span className="text-[#00e676] flex items-center gap-1 font-bold">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#00e676] inline-block" /> Live Active
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Close / Collapse button */}
            <button
              onClick={() => setIsDrawerOpen(false)}
              className="p-1.5 rounded-xl text-gray-400 hover:text-white hover:bg-white/10 transition lg:hidden"
              title="Close Menu"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center border-t border-[#193224] px-2 py-1 bg-[#0a1610] gap-1 overflow-x-auto no-scrollbar">
            {[
              { id: 'coach', label: 'Tactics', icon: BrainCircuit },
              { id: 'settings', label: 'Settings', icon: SettingsIcon },
              { id: 'balls', label: 'Balls', icon: Zap },
              { id: 'guide', label: 'Guide', icon: BookOpen }
            ].map(tab => {
              const Icon = tab.icon;
              const isActive = drawerTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setDrawerTab(tab.id as any)}
                  className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 whitespace-nowrap ${
                    isActive 
                      ? 'bg-[#193425] text-[#00e5ff] border border-[#00e5ff]/30 shadow-sm' 
                      : 'text-gray-400 hover:text-gray-200 hover:bg-[#12241a]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Tab 1: Tactical Coach */}
        {drawerTab === 'coach' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* AI Hint Card */}
            <div className="bg-[#12221a] p-3.5 rounded-2xl border border-[#1f3e2e] shadow-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#00e5ff] flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> Coach Insight
                </span>
                <span className="text-[10px] font-bold text-[#00e676] bg-[#00e676]/15 px-2 py-0.5 rounded">
                  xG {aiHint.expectedGoalRate || 88}% Goal Prob
                </span>
              </div>
              <p className="text-white font-bold text-sm leading-snug">
                {aiHint.message}
              </p>
              {aiHint.rationale && (
                <div className="flex gap-2 mt-2.5 bg-black/40 p-2.5 rounded-xl border border-white/5">
                  <Lightbulb className="w-4 h-4 text-[#00e5ff] shrink-0 mt-0.5" />
                  <p className="text-xs text-gray-300 leading-relaxed">
                    {aiHint.rationale}
                  </p>
                </div>
              )}
              {/* Direct Aim Action */}
              <div className="mt-3 pt-2.5 border-t border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs text-gray-400 font-bold uppercase">
                  <Target className="w-3.5 h-3.5 text-[#00e5ff]" /> Recommended:
                </div>
                <button
                  onClick={() => {
                    if (aiHint.recommendedZone) {
                      handleDirectTargetKick(aiHint.recommendedZone);
                      if (window.innerWidth < 1024) setIsDrawerOpen(false);
                    }
                  }}
                  className="px-2.5 py-1 rounded-lg bg-[#00e5ff]/20 text-[#00e5ff] hover:bg-[#00e5ff]/30 text-xs font-black uppercase transition flex items-center gap-1 border border-[#00e5ff]/40"
                >
                  Strike {aiHint.recommendedZone?.replace('-', ' ')}
                </button>
              </div>
            </div>

            {/* Goalkeeper Scouting Card */}
            <div>
              <div className="flex items-center gap-2 mb-2 text-xs font-bold text-gray-400 uppercase tracking-wider">
                <ShieldAlert className="w-3.5 h-3.5 text-[#ff9100]" /> Goalkeeper Scouting
              </div>
              <div className="bg-[#12221a] p-3.5 rounded-xl border border-[#1f3e2e] space-y-2.5 text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Match Difficulty:</span>
                  <span className="font-bold text-white bg-[#0b1610] px-2 py-0.5 rounded border border-[#1f3e2e]">
                    {difficulty}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Dive Tendency:</span>
                  <span className="font-bold text-[#00e5ff] capitalize">{gkStateRef.current.tendency.replace('_', ' ')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Shot Guidance:</span>
                  <span className="font-bold text-gray-200">{aiHint.shotPowerAdvice || "High power corner"}</span>
                </div>
              </div>
            </div>

            {/* Vision Input Snapshot */}
            {debugInfo?.screenshotBase64 && (
              <div>
                <div className="flex items-center gap-2 mb-2 text-xs font-bold text-gray-400 uppercase tracking-wider">
                  <Eye className="w-3.5 h-3.5 text-[#00e5ff]" /> Live Vision Frame Analysis
                </div>
                <div className="rounded-xl overflow-hidden border border-[#1f3e2e] bg-black/60 relative group">
                  <img 
                    src={debugInfo.screenshotBase64} 
                    alt="AI Vision Frame" 
                    className="w-full h-auto opacity-85 group-hover:opacity-100 transition-opacity" 
                  />
                  <div className="absolute bottom-0 inset-x-0 bg-black/80 p-1.5 text-[10px] text-center text-gray-400 font-mono">
                    Analyzed via gemini-3.7-flash ({debugInfo.latency}ms)
                  </div>
                </div>
              </div>
            )}

            {/* Match Context Prompt */}
            {debugInfo?.promptContext && (
              <div>
                <div className="flex items-center gap-2 mb-2 text-xs font-bold text-gray-400 uppercase tracking-wider">
                  <Terminal className="w-3.5 h-3.5 text-gray-400" /> Match Context Prompt
                </div>
                <div className="bg-[#08100c] p-3 rounded-xl border border-[#1f3e2e] font-mono text-[10px] text-gray-400 max-h-28 overflow-y-auto whitespace-pre-wrap leading-tight">
                  {debugInfo.promptContext}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Match Settings */}
        {drawerTab === 'settings' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
            
            {/* Difficulty Setting */}
            <div className="bg-[#12221a] p-3.5 rounded-2xl border border-[#1f3e2e] space-y-2">
              <p className="font-bold text-white uppercase text-[11px]">🏆 Match Difficulty</p>
              <div className="grid grid-cols-2 gap-2">
                {(['Rookie', 'Pro', 'World Class', 'Legendary'] as const).map(diff => (
                  <button
                    key={diff}
                    onClick={() => setDifficulty(diff)}
                    className={`py-2 px-2.5 rounded-xl font-bold transition text-center ${
                      difficulty === diff 
                        ? 'bg-[#00e5ff] text-black shadow-lg shadow-[#00e5ff]/20 font-black' 
                        : 'bg-[#0b1610] text-gray-300 hover:bg-[#162c20] hover:text-white border border-[#1f3e2e]'
                    }`}
                  >
                    {diff}
                  </button>
                ))}
              </div>
            </div>

            {/* Input Controls Mode */}
            <div className="bg-[#12221a] p-3.5 rounded-2xl border border-[#1f3e2e] space-y-2.5">
              <p className="font-bold text-white uppercase text-[11px]">🎮 Control Input Mode</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setUseCamera(false)}
                  className={`p-2.5 rounded-xl font-bold transition flex flex-col items-center gap-1 text-center ${
                    !useCamera 
                      ? 'bg-[#00e676] text-black font-black shadow-md' 
                      : 'bg-[#0b1610] text-gray-300 hover:bg-[#162c20] border border-[#1f3e2e]'
                  }`}
                >
                  <MousePointer className="w-4 h-4" />
                  <span>Touch / Mouse</span>
                </button>
                <button
                  onClick={() => setUseCamera(true)}
                  className={`p-2.5 rounded-xl font-bold transition flex flex-col items-center gap-1 text-center ${
                    useCamera 
                      ? 'bg-[#00e5ff] text-black font-black shadow-md' 
                      : 'bg-[#0b1610] text-gray-300 hover:bg-[#162c20] border border-[#1f3e2e]'
                  }`}
                >
                  <Camera className="w-4 h-4" />
                  <span>Camera Gesture</span>
                </button>
              </div>
            </div>

            {/* Visual Overlays & Audio */}
            <div className="bg-[#12221a] p-3.5 rounded-2xl border border-[#1f3e2e] space-y-3">
              <p className="font-bold text-white uppercase text-[11px]">⚙️ Display & Audio</p>
              
              {/* Skeleton toggle */}
              <div className="flex items-center justify-between">
                <span className="text-gray-300">Hand Skeleton Overlay:</span>
                <button
                  onClick={() => setShowSkeleton(!showSkeleton)}
                  className={`px-3 py-1 rounded-lg font-bold transition ${
                    showSkeleton ? 'bg-[#00e676]/20 text-[#00e676] border border-[#00e676]' : 'bg-[#0b1610] text-gray-400 border border-[#1f3e2e]'
                  }`}
                >
                  {showSkeleton ? 'ON' : 'OFF'}
                </button>
              </div>

              {/* Reticle toggle */}
              <div className="flex items-center justify-between">
                <span className="text-gray-300">Tactical Target Reticle:</span>
                <button
                  onClick={() => setShowAiReticle(!showAiReticle)}
                  className={`px-3 py-1 rounded-lg font-bold transition ${
                    showAiReticle ? 'bg-[#00e5ff]/20 text-[#00e5ff] border border-[#00e5ff]' : 'bg-[#0b1610] text-gray-400 border border-[#1f3e2e]'
                  }`}
                >
                  {showAiReticle ? 'ON' : 'OFF'}
                </button>
              </div>

              {/* Sound toggle */}
              <div className="flex items-center justify-between">
                <span className="text-gray-300">Audio Sound Effects:</span>
                <button
                  onClick={handleToggleMute}
                  className={`px-3 py-1 rounded-lg font-bold transition ${
                    !isMuted ? 'bg-[#00e676]/20 text-[#00e676] border border-[#00e676]' : 'bg-[#0b1610] text-gray-400 border border-[#1f3e2e]'
                  }`}
                >
                  {!isMuted ? 'UNMUTED' : 'MUTED'}
                </button>
              </div>
            </div>

            {/* Restart Match Button */}
            <button
              onClick={() => {
                restartMatch();
                if (window.innerWidth < 1024) setIsDrawerOpen(false);
              }}
              className="w-full py-3 rounded-2xl bg-[#162c20] hover:bg-[#1f3e2e] text-white font-bold transition border border-[#1f3e2e] flex items-center justify-center gap-2"
            >
              <RotateCcw className="w-4 h-4 text-[#00e5ff]" />
              <span>Restart Tournament Shootout</span>
            </button>
          </div>
        )}

        {/* Tab 3: Ball Skins */}
        {drawerTab === 'balls' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Select Match Ball:</p>
            {(Object.keys(BALL_SKINS) as BallSkin[]).map(skinKey => {
              const config = BALL_SKINS[skinKey];
              const isSelected = activeBall === skinKey;

              return (
                <div
                  key={skinKey}
                  onClick={() => setActiveBall(skinKey)}
                  className={`p-3.5 rounded-2xl border cursor-pointer transition-all flex items-center justify-between ${
                    isSelected 
                      ? 'bg-[#153423] border-[#00e5ff] shadow-lg shadow-[#00e5ff]/15 ring-1 ring-[#00e5ff]' 
                      : 'bg-[#102018] border-[#1f3e2e] hover:bg-[#162c20]'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-black/40 border border-white/10 flex items-center justify-center text-xl">
                      {skinKey === 'classic' ? '⚽' : skinKey === 'gold' ? '🏆' : skinKey === 'fire' ? '🔥' : '⚡'}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-white text-sm">{config.name}</p>
                        {isSelected && (
                          <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-[#00e5ff] text-black">
                            ACTIVE
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">{config.bonus}</p>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="text-xs font-mono font-bold text-[#ffd700] bg-black/40 px-2 py-1 rounded-lg">
                      {config.multiplier}x Multiplier
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Tab 4: Guide & Instructions */}
        {drawerTab === 'guide' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
            <div className="bg-[#12221a] p-3.5 rounded-2xl border border-[#1f3e2e] space-y-2">
              <p className="font-bold text-white uppercase text-[11px] mb-1">📱 Mobile Touch & Flick:</p>
              <p className="text-gray-300 leading-relaxed">
                • <strong className="text-white">Swipe Kick:</strong> Place your finger on the ball and flick forward towards the goal.
              </p>
              <p className="text-gray-300 leading-relaxed">
                • <strong className="text-[#00e5ff]">Slingshot:</strong> Drag down below the ball to pull back with trajectory guide, then release to shoot.
              </p>
              <p className="text-gray-300 leading-relaxed">
                • <strong className="text-[#00e676]">Quick Tap:</strong> Tap any target zone button on the bottom bar for instant precision placement.
              </p>
            </div>

            <div className="bg-[#12221a] p-3.5 rounded-2xl border border-[#1f3e2e] space-y-2">
              <p className="font-bold text-white uppercase text-[11px] mb-1">📷 Webcam Pinch Gesture:</p>
              <p className="text-gray-300 leading-relaxed">
                • Pinch thumb and index finger together within 100px of the ball.
              </p>
              <p className="text-gray-300 leading-relaxed">
                • Pull back or swipe forward, then release pinch to launch the shot!
              </p>
            </div>

            <div className="bg-[#12221a] p-3.5 rounded-2xl border border-[#1f3e2e] space-y-2">
              <p className="font-bold text-white uppercase text-[11px] mb-1">🎯 Goal Zones & Points:</p>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="p-2 rounded bg-black/40 border border-white/5">
                  <p className="text-[#00e5ff] font-bold">Top Bins (Corners)</p>
                  <p className="text-gray-300">500 pts + Multiplier</p>
                </div>
                <div className="p-2 rounded bg-black/40 border border-white/5">
                  <p className="text-white font-bold">Roof of Net</p>
                  <p className="text-gray-300">350 pts</p>
                </div>
                <div className="p-2 rounded bg-black/40 border border-white/5">
                  <p className="text-gray-200 font-bold">Low Corners</p>
                  <p className="text-gray-300">300 pts</p>
                </div>
                <div className="p-2 rounded bg-black/40 border border-white/5">
                  <p className="text-[#ffd700] font-bold">Panenka Chip</p>
                  <p className="text-gray-300">200 pts</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Footer Brand */}
        <div className="p-3 bg-[#0a140f] border-t border-[#193224] text-center text-[11px] text-gray-500 font-medium">
          Powered by <span className="text-gray-300 font-bold">Google Gemini 3.7 Flash</span>
        </div>
      </div>
    </div>
  );
};

export default FootballPenalty;
