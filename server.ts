import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Increase payload limit for base64 images
  app.use(express.json({ limit: '10mb' }));

  // Initialize Gemini Client
  let ai: GoogleGenAI | null = null;
  if (process.env.API_KEY || process.env.GEMINI_API_KEY) {
    ai = new GoogleGenAI({ 
      apiKey: process.env.API_KEY || process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  } else {
    console.error("GEMINI_API_KEY is missing from environment variables.");
  }

  const CANDIDATE_MODELS = ["gemini-3.7-flash", "gemini-2.5-flash"];

  // API routes FIRST
  app.post("/api/gemini", async (req, res) => {
    const { imageBase64, context, gkState } = req.body;
    
    const debug = {
      latency: 0,
      screenshotBase64: imageBase64,
      promptContext: "",
      rawResponse: "",
      timestamp: new Date().toLocaleTimeString()
    };
    const startTime = performance.now();

    const getLocalTacticalFallback = (reason = "Tactical scout fallback") => {
      let recZone = 'top-left';
      if (gkState.tendency === 'favors_left') {
        recZone = 'top-right';
      } else if (gkState.tendency === 'favors_right') {
        recZone = 'top-left';
      } else if (gkState.tendency === 'aggressive_high') {
        recZone = 'bottom-right';
      } else {
        recZone = Math.random() > 0.5 ? 'top-left' : 'top-right';
      }

      const zoneDescriptions: Record<string, string> = {
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
        rationale: `Tactical Scout: Keeper ${gkState.tendency.replace('_', ' ')}. ${zoneDescriptions[recZone]}`,
        recommendedZone: recZone,
        recommendedBall: context.activeBall,
        goalkeeperAnalysis: `GK Reaction skill is ${(context.gkSkill * 100).toFixed(0)}%. Tendency: ${gkState.tendency.replace('_', ' ')}.`,
        shotPowerAdvice: "80% - 90% power recommended to beat diving glove reach.",
        curveAdvice: recZone.includes('left') ? "Apply right-to-left inward curl." : "Drive with slight outward slice.",
        expectedGoalRate: Math.round(75 + (1 - context.gkSkill) * 20)
      };
    };

    if (!ai) {
      return res.json({
        hint: getLocalTacticalFallback("API Key not configured"),
        debug: { ...debug, error: "API Key not configured, using local tactical engine" }
      });
    }

    const promptContextText = `
### MATCH SITUATION:
- Penalty Kick Round: ${context.round} of ${context.maxRounds}
- Current Score: ${context.score} pts (Current Streak: ${context.streak})
- Goalkeeper Skill Level: ${(context.gkSkill * 100).toFixed(0)}% (Tendency: ${context.gkTendency})
- Recent Kicks: ${context.previousAttempts.map((a: any, i: number) => `Kick ${i+1}: ${a.scored ? 'GOAL (' + a.zone + ')' : 'SAVED/MISSED'}`).join(', ') || 'First kick'}
- Current Ball: ${context.activeBall}
- Stadium Wind: ${context.windMph} km/h

### TARGET ZONES ON GOAL:
1. "top-left" - Top Bins (500 pts) - Highest difficulty, unbeatable if struck clean
2. "top-right" - Top Bins (500 pts) - Highest difficulty, upper right postage stamp
3. "bottom-left" - Low Left Corner (300 pts) - Fast skidding strike to side netting
4. "bottom-right" - Low Right Corner (300 pts) - Hard low drive to side netting
5. "top-center" - High Center (350 pts) - High power roof of net
6. "bottom-center" - Panenka / Low Center (200 pts) - Effective if keeper dives early
`;

    debug.promptContext = promptContextText;

    const systemInstruction = `
You are the world's leading Football Penalty Tactical Coach and Goalkeeper Scout analyzing a live webcam penalty shootout.
Analyze the goalkeeper's body stance, weight distribution, and historical tendencies from the match context and screenshot.
Select the optimal shot location (zone), calculate the expected goal xG probability percentage (0-100), and provide punchy tactical advice for the penalty taker.

Always return valid RAW JSON conforming strictly to the requested schema. No Markdown wrapper.
`;

    const prompt = `
Analyze this penalty shootout frame.
${promptContextText}

Return a JSON object with this exact structure:
{
  "message": "Punchy 3-5 word directive (e.g., 'Aim Top Left Postage Stamp!')",
  "rationale": "One clear tactical sentence explaining why this exploits the goalkeeper's position or weakness.",
  "recommendedZone": "top-left" | "top-right" | "bottom-left" | "bottom-right" | "top-center" | "bottom-center",
  "recommendedBall": "classic" | "gold" | "fire" | "neon",
  "goalkeeperAnalysis": "Brief observation of the keeper's stance or dive bias.",
  "shotPowerAdvice": "Power guidance (e.g., '85% high velocity')",
  "curveAdvice": "Curling direction advice (e.g., 'Whip with outside-of-the-foot swerve')",
  "expectedGoalRate": integer (0 to 100)
}
`;

    let cleanBase64 = "";
    if (imageBase64 && typeof imageBase64 === 'string') {
      cleanBase64 = imageBase64.replace(/^data:image\/(png|jpeg|jpg);base64,/, "");
    }

    let lastApiError: any = null;

    for (const modelName of CANDIDATE_MODELS) {
      try {
        const contentsPayload = cleanBase64 ? {
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: cleanBase64
              }
            }
          ]
        } : {
          parts: [{ text: prompt }]
        };

        const response = await ai.models.generateContent({
          model: modelName,
          contents: contentsPayload,
          config: {
            systemInstruction,
            temperature: 0.3,
            responseMimeType: "application/json"
          }
        });

        const endTime = performance.now();
        debug.latency = Math.round(endTime - startTime);

        let text = response.text || "{}";
        debug.rawResponse = text;

        const firstBrace = text.indexOf('{');
        const lastBrace = text.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          text = text.substring(firstBrace, lastBrace + 1);
        }

        try {
          const json = JSON.parse(text);
          
          const validZones = ['top-left', 'top-right', 'top-center', 'bottom-left', 'bottom-right', 'bottom-center'];
          const recZone = validZones.includes(json.recommendedZone) ? json.recommendedZone : 'top-left';

          return res.json({
            hint: {
              message: json.message || `Strike for ${recZone.replace('-', ' ').toUpperCase()}!`,
              rationale: json.rationale || "Exploits the goalkeeper's open pocket.",
              recommendedZone: recZone,
              recommendedBall: json.recommendedBall || context.activeBall,
              goalkeeperAnalysis: json.goalkeeperAnalysis || `Goalkeeper stance leaning towards ${gkState.tendency.replace('_', ' ')}.`,
              shotPowerAdvice: json.shotPowerAdvice || "85% power recommended",
              curveAdvice: json.curveAdvice || "Aim for side netting with natural curl",
              expectedGoalRate: typeof json.expectedGoalRate === 'number' ? json.expectedGoalRate : 82
            },
            debug
          });
        } catch (parseError: any) {
          console.warn("Failed to parse Gemini JSON:", parseError);
          return res.json({
            hint: getLocalTacticalFallback("AI parse fallback"),
            debug: { ...debug, error: `Parse error: ${parseError.message}` }
          });
        }
      } catch (apiError: any) {
        lastApiError = apiError;
        console.warn(`Gemini model ${modelName} encountered error:`, apiError?.message || apiError);
      }
    }

    // Graceful fallback when all remote API calls fail (e.g. rate limit, quota exceeded)
    const endTime = performance.now();
    debug.latency = Math.round(endTime - startTime);
    return res.json({
      hint: getLocalTacticalFallback("Tactical heuristic engine (Quota/Rate Limit protected)"),
      debug: { 
        ...debug, 
        error: lastApiError?.message || "Rate limit / Quota exceeded, using tactical scout heuristic"
      }
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
