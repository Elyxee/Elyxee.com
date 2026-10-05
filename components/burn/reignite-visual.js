// Cold → flame handoff, at cursor scale. Render-only: this is spliced into the
// pulse block of every composite shader (first-pass recovery, later-pass, and
// the current fire pass) so the vortex hands over to the flame the same way no
// matter which renderer happens to be on screen. It writes nothing to state.
//
// Expects, in scope: prog (0→1 over the handoff), toCold, env, pd, toP, ap,
// hot, uTime, uNoise, color. Declares `vec3 burst`, which the caller adds as
// `mix(burst, quench, toCold) * env`.
//
// Nothing bursts. The wind has already let go underneath (uInteract eases out
// over the first half), so what is left at the eye melts, steams off, and a coal
// catches in the wet dark and lifts into a first tongue of fire, which the flame
// cursor then grows out of. Every edge is torn by a field sampled in place —
// never on the angle to the pointer, which is what draws rays and rings.
export const REIGNITE_GLSL = `
    // Cold → flame. See reignite-visual.js.
    vec2 rgDrift = vec2(uTime * 0.05, -uTime * 0.11);
    float rgFieldA = texture2D(uNoise, ap * 6.0 + rgDrift).r;
    float rgFieldB = texture2D(uNoise, ap * 15.0 - rgDrift * 1.7).g;
    // The coal's breath: noise walked in time, so it never settles into a beat.
    float rgBreathA = texture2D(uNoise, vec2(uTime * 0.27, 0.37)).b;
    float rgBreathB = texture2D(uNoise, vec2(uTime * 0.90 + 0.5, 0.71)).a;
    float rgFlicker = 0.70 + 0.20 * rgBreathA + 0.14 * rgBreathB;
    float rgThaw = (1.0 - toCold) * env;

    // 1. Melt. The frost at the eye goes dark and wet, on a ragged edge.
    float rgMeltIn = smoothstep(0.0, 0.45, prog) * (1.0 - smoothstep(0.70, 1.0, prog));
    float rgMeltR = (0.018 + 0.050 * smoothstep(0.0, 0.60, prog)) * (0.75 + 0.50 * rgFieldA);
    float rgMelt = exp(-(pd * pd) / (rgMeltR * rgMeltR)) * rgMeltIn;
    color = mix(color, color * vec3(0.78, 0.80, 0.86), rgMelt * 0.55 * rgThaw);

    // 2. Steam. Pale wisps lifting off the melt, thinning as they climb.
    vec2 rgSteamP = (toP - vec2(0.0, prog * 0.09)) * vec2(1.0, 0.60);
    float rgSteamR = 0.020 + 0.055 * prog;
    float rgSteamN = texture2D(uNoise, (ap + vec2(0.0, -uTime * 0.09)) * 9.0).g;
    float rgSteam = exp(-dot(rgSteamP, rgSteamP) / (rgSteamR * rgSteamR))
      * smoothstep(0.42, 0.85, rgSteamN + 0.15 * rgFieldB)
      * smoothstep(0.05, 0.35, prog) * (1.0 - smoothstep(0.55, 0.95, prog));
    vec3 burst = vec3(0.66, 0.72, 0.80) * rgSteam * 0.34;

    // 3. Heat. Dry warmth spreads out through the wet and undoes the cold cast.
    float rgHeatIn = smoothstep(0.22, 0.75, prog);
    float rgHeatR = (0.010 + 0.060 * rgHeatIn) * (0.80 + 0.40 * rgFieldA);
    float rgHeat = exp(-(pd * pd) / (rgHeatR * rgHeatR)) * rgHeatIn;
    color = mix(color, color * vec3(1.10, 0.96, 0.84), rgHeat * 0.45 * rgThaw);

    // 4. Coal. A deep red point catches, breathes, and brightens to orange.
    float rgCoalIn = smoothstep(0.20, 0.55, prog);
    float rgCoalR = mix(0.004, 0.014, rgCoalIn) * (0.90 + 0.20 * rgFlicker);
    float rgCoal = exp(-(pd * pd) / (rgCoalR * rgCoalR)) * rgCoalIn * rgFlicker;
    vec3 rgCoalTone = mix(vec3(0.55, 0.07, 0.015), vec3(1.0, 0.50, 0.14), smoothstep(0.30, 0.80, prog));
    burst += rgCoalTone * rgCoal * 1.6;
    // Its glow on what is around it.
    float rgGlowR = rgCoalR * 3.2 * (0.85 + 0.30 * rgFieldB);
    burst += vec3(0.55, 0.16, 0.04) * exp(-(pd * pd) / (rgGlowR * rgGlowR)) * rgCoalIn * rgFlicker * 0.45;

    // 5. Tongue. The coal's light stretches upward into a first flame, torn at
    // the top by the field; the flame cursor is fading in over it by now.
    float rgTongueIn = smoothstep(0.50, 0.85, prog);
    vec2 rgTp = toP - vec2(0.0, 0.016 * rgTongueIn);
    rgTp.y *= 0.50;
    float rgTongueR = 0.006 + 0.016 * rgTongueIn;
    float rgTongueN = texture2D(uNoise, (ap + vec2(0.0, -uTime * 0.35)) * 20.0).r;
    float rgTongue = exp(-dot(rgTp, rgTp) / (rgTongueR * rgTongueR)) * rgTongueIn * rgFlicker
      * mix(1.0, smoothstep(0.25, 0.70, rgTongueN), smoothstep(0.0, 0.03, toP.y));
    vec3 rgTongueTone = mix(hot, vec3(1.0, 0.86, 0.55), exp(-(pd * pd) / (0.006 * 0.006)));
    burst += rgTongueTone * rgTongue * 1.4;

    // 6. Sparks. A few specks lifting off the coal.
    vec2 rgRiseP = toP - vec2(0.0, prog * 0.05);
    float rgSparkField = texture2D(uNoise, ap * 40.0 + vec2(0.0, -uTime * 1.1)).b;
    float rgSparks = exp(-dot(rgRiseP, rgRiseP) / (0.030 * 0.030))
      * smoothstep(0.90, 0.975, rgSparkField)
      * smoothstep(0.35, 0.60, prog) * (1.0 - smoothstep(0.75, 1.0, prog));
    burst += vec3(1.0, 0.70, 0.34) * rgSparks * 1.2;
`;
