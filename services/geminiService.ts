/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { StrategicHint, AiResponse, DebugInfo, GoalZone, BallSkin, GoalkeeperState, TacticalContext } from "../types";

export const getPenaltyTactics = async (
  imageBase64: string,
  context: TacticalContext,
  gkState: GoalkeeperState
): Promise<AiResponse> => {
  const startTime = performance.now();

  const debug: DebugInfo = {
    latency: 0,
    screenshotBase64: imageBase64,
    promptContext: "Sent to server",
    rawResponse: "",
    timestamp: new Date().toLocaleTimeString()
  };

  const getLocalTacticalFallback = (reason: string = "Tactical scout fallback"): StrategicHint => {
    let recZone: GoalZone = 'top-left';
    if (gkState.tendency === 'favors_left') {
      recZone = 'top-right';
    } else if (gkState.tendency === 'favors_right') {
      recZone = 'top-left';
    } else if (gkState.tendency === 'aggressive_high') {
      recZone = 'bottom-right';
    } else {
      recZone = Math.random() > 0.5 ? 'top-left' : 'top-right';
    }

    const zoneDescriptions: Record<GoalZone, string> = {
      'top-left': 'Top Bins (Upper Left Corner) - High reward strike just inside the crossbar.',
      'top-right': 'Top Bins (Upper Right Corner) - Precision curler into the top postage stamp.',
      'top-center': 'Under the Crossbar - Power drive above the goalkeeper.',
      'bottom-left': 'Low Left Corner - Skidding grass-cutter right into the bottom corner.',
      'bottom-right': 'Low Right Corner - Hard placed finish away from the keeper’s reach.',
      'bottom-center': 'Panenka Center - Cheeky chip down the middle if keeper commits early.',
      'post': 'Near Post',
      'miss': 'Off Target'
    };

    return {
      message: `Shoot towards ${recZone.replace('-', ' ').toUpperCase()}!`,
      rationale: `Scouting Report: Goalkeeper ${gkState.tendency.replace('_', ' ')}. ${zoneDescriptions[recZone]}`,
      recommendedZone: recZone,
      recommendedBall: context.activeBall,
      goalkeeperAnalysis: `GK Reaction skill is ${(context.gkSkill * 100).toFixed(0)}%. Tendency: ${gkState.tendency.replace('_', ' ')}.`,
      shotPowerAdvice: "80% - 90% power recommended to beat diving glove reach.",
      curveAdvice: recZone.includes('left') ? "Apply right-to-left inward curl." : "Drive with slight outward slice.",
      expectedGoalRate: Math.round(75 + (1 - context.gkSkill) * 20)
    };
  };

  try {
    const response = await fetch('/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64, context, gkState })
    });
    
    if (response.ok) {
      const data = await response.json();
      return data as AiResponse;
    }
    
    const errText = await response.text();
    const endTime = performance.now();
    debug.latency = Math.round(endTime - startTime);
    return {
      hint: getLocalTacticalFallback("Local Tactical Engine"),
      debug: { ...debug, error: `HTTP ${response.status}: ${errText}` }
    };
  } catch (error: any) {
    const endTime = performance.now();
    debug.latency = Math.round(endTime - startTime);
    return {
      hint: getLocalTacticalFallback("Local Tactical Engine"),
      debug: { ...debug, error: error.message || "Unknown error" }
    };
  }
};
