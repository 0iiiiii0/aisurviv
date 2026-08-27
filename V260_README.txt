V260 full project package

Base: V257 full project supplied by the user.
Included: V258 extraction team fix + V259 nuclear achievement production fix + V260 AI combat regression fixes.

Primary report:
  docs/validation/V260_AI_COMBAT_ANALYSIS.md

Primary regression test:
  server/src/v260DuelCombatRegressionSmokeTest.ts

After replacing an existing deployment, rebuild/restart the server so dist/ and worker processes use V260 code.
