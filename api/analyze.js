const { getUser, readBody } = require('./_auth');

// The local rules (threat detection, safety floors) are shared with the browser and the tests.
const Risk = require('../risk-engine.js');
const hasThreat = (txt) => Risk.detectThreatToOthers(txt);
const TIMEOUT_MS = 9000; // per provider — a stuck provider must not hold the student's request open

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Sign in required' });

  const body = readBody(req);
  const text = typeof body.text === 'string' ? body.text.slice(0, 2000) : '';
  if (!text.trim()) {
    return res.status(400).json({ error: 'text is required' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey && !process.env.ANTHROPIC_API_KEY && !process.env.GITHUB_MODELS_TOKEN) {
    console.error('[analyze] No AI key set (GROQ_API_KEY / GITHUB_MODELS_TOKEN / ANTHROPIC_API_KEY)');
    const local = Risk.analyzeRisk(text);
    return res.status(200).json({ score: local.score, level: local.level, flagged: local.flagged, reasons: local.reasons, aiUnavailable: true });
  }

  // ── LEWD WORD FILTER ──────────────────────────────────────────────────────
  // Strip Filipino/English sexual slang and profanity BEFORE sending to AI.
  // This prevents the AI from treating crude language as a risk signal.
  // Words are replaced with [removed] so sentence structure is preserved.
  const lewdPatterns = [
    // Crude slang only. Words like sex/sexual/nude/porn/boobs/hubo(g)/bola are NOT stripped:
    // students use them to describe abuse, grooming and sextortion, and the AI must see them.
    /\bj[a4]k[a4o0]l+\b/gi,           // jakol
    /\bsals[a4]l+\b/gi,               // salsal
    /\bm[a4]st[eu]rb[a4]t?(e|ion|syon)?\b/gi,   // masturbate / masterbate / masturbasyon
    /\bkant[o0]t+\b/gi,               // kantot
    /\bp[e3]t[e3]k\b/gi,
    /\bburat+\b/gi,
    /\bt[i1]t[i1]t?\b/gi,             // titi / titit
    /\bp[e3]kp[e3]k\b/gi,
    /\bp[uo]k[i1]+\b/gi,
    /\biyot+\b/gi,
    /\bwank(ing|er)?\b/gi,
    /\bjerk(ing)?[ -]?off\b/gi,
  ];

  let cleanedText = text;
  for (const pattern of lewdPatterns) {
    cleanedText = cleanedText.replace(pattern, '[removed]');
  }

  // ─────────────────────────────────────────────────────────────────────────

  const systemPrompt = `You are a school-safety risk analyst for Quirino High School (Philippines). Read ONE student-submitted text and rate how urgently a guidance counselor must act. Students write English, Filipino/Tagalog and Taglish, often indirectly, with typos, ALL CAPS or humor. Judge meaning, not formatting. When unsure, rate HIGHER: a false alarm is safer than a missed crisis. "joke lang"/"haha" never lowers the risk.

SCORE (0-20) from the most serious signals found:
14-20 HIGH (immediate danger): wants/plans to kill or hurt OTHER people or the school (any threat, even vague like "I will kill someone"); suicide intent, plan or method; active self-harm; asking how to self-harm; being attacked or abused right now; weapon brought to school.
7-13 MEDIUM: passive suicidal wishes (disappear, not wake up); past self-harm; severe depression or hopelessness; sexual abuse, assault, grooming, sextortion; severe physical abuse; severe eating disorder; hallucinations/psychosis; heavy drug use; gang involvement; weapon knowledge; running away; pregnancy fear.
3-6 LOW-MEDIUM: bullying or cyberbullying victim; emotional abuse; neglect; grief; anxiety/panic; trauma; family crisis; homelessness; alcohol/vaping to cope; relationship abuse; self-esteem or body-image distress; academic burnout.
0-2 LOW: normal stress, mild loneliness, friendship or teacher conflict, or nothing concerning.

RULES:
- Threats against others are never "just profanity": always HIGH, score at least 14.
- Profanity, crude slang or [removed] tokens alone, with no distress and no threat = score 0.
- Figures of speech about oneself or schoolwork ("kill this exam", "patay ako sa nanay ko") = Low unless real danger appears.
- Two or more different HIGH signals = score 18-20.

LEVEL: 0-2 Low | 3-6 Low-Medium | 7-13 Medium | 14-20 High. "flagged" = true when score >= 3.

EXAMPLES:
"i will kill someone" -> {"score":18,"level":"High","flagged":true,"reasons":["Threat to harm others"]}
"I will blow out the school" -> {"score":18,"level":"High","flagged":true,"reasons":["Threat against school"]}
"papatayin ko kayo lahat" -> {"score":18,"level":"High","flagged":true,"reasons":["Threat to harm others"]}
"gusto ko nang mamatay" -> {"score":16,"level":"High","flagged":true,"reasons":["Suicidal ideation"]}
"sinasaktan ako ng tatay ko gabi-gabi" -> {"score":12,"level":"Medium","flagged":true,"reasons":["Physical abuse"]}
"gago ka putang ina" -> {"score":0,"level":"Low","flagged":false,"reasons":[]}
"I will kill this exam tomorrow" -> {"score":0,"level":"Low","flagged":false,"reasons":[]}

Reply with ONLY one JSON object: {"score":<integer 0-20>,"level":"Low"|"Low-Medium"|"Medium"|"High","flagged":<boolean>,"reasons":[<short strings>]}`;

  const userMessage = `Analyze this student submission for risk:\n\n${cleanedText}`;

  // ── PROVIDERS ─────────────────────────────────────────────────────────────
  // Order: Claude (if ANTHROPIC_API_KEY is set) -> Groq models. First one that answers wins.
  // llama-3.3-70b-versatile was shut down by Groq on 16 Aug 2026.
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  async function callClaude(model) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: 300,
        temperature: 0,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }]
      })
    });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data, text: data?.content?.[0]?.text || '' };
  }

  async function callGroq(model) {
    const payload = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.1,
      max_completion_tokens: 700, // reasoning models think first, then print the short JSON
      response_format: { type: 'json_object' },
    };
    if (/gpt-oss/.test(model)) payload.reasoning_effort = 'low';
    let out;
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(payload)
      });
      const data = await r.json().catch(() => ({}));
      out = { ok: r.ok, status: r.status, data, text: data?.choices?.[0]?.message?.content || '' };
      if (r.status !== 429) break;
      const wait = Math.min(1200, (parseFloat(r.headers.get('retry-after')) || 1) * 1000);
      await sleep(wait); // short rate-limit hiccup: wait once, retry the same model
    }
    return out;
  }

  // GitHub Models: free with a GitHub token that has the "models:read" permission.
  async function callGithub(model) {
    const r = await fetch('https://models.github.ai/inference/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Authorization': `Bearer ${process.env.GITHUB_MODELS_TOKEN}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.1,
        max_tokens: 400
      })
    });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data, text: data?.choices?.[0]?.message?.content || '' };
  }

  const attempts = [];
  if (process.env.ANTHROPIC_API_KEY) attempts.push(() => callClaude(process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001'));
  const groqModels = [process.env.GROQ_MODEL || 'openai/gpt-oss-120b', 'openai/gpt-oss-20b']
    .filter((m, i, arr) => arr.indexOf(m) === i);
  if (apiKey) groqModels.forEach(m => attempts.push(() => callGroq(m)));
  // GitHub Models free tier has low rate limits, so it is a backup after Groq.
  if (process.env.GITHUB_MODELS_TOKEN) {
    attempts.push(() => callGithub(process.env.GITHUB_MODELS_MODEL || 'openai/gpt-4.1-mini'));
  }
  if (apiKey) attempts.push(() => callGroq('qwen/qwen3.6-27b')); // last resort

  function parseResult(raw) {
    const cleaned = String(raw || '').replace(/```json|```/g, '').trim();
    const m = cleaned.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(m ? m[0] : cleaned);
    if (typeof parsed.score !== 'number' || !parsed.level || !Array.isArray(parsed.reasons)) {
      throw new Error('Unexpected response shape');
    }
    parsed.score = Math.max(0, Math.min(Math.round(parsed.score), 20));
    if (typeof parsed.flagged !== 'boolean') parsed.flagged = parsed.score >= 3 || parsed.level !== 'Low';
    return parsed;
  }

  for (const attempt of attempts) {
    try {
      const out = await attempt();
      if (!out.ok) { console.error('[analyze] provider error', out.status, JSON.stringify(out.data).slice(0, 400)); continue; }
      const parsed = parseResult(out.text);
      // Safety floors (same code the browser uses): a clear threat or a direct statement of wanting
      // to die is always High, and anything the local rules rate High never drops below Medium.
      return res.status(200).json(Risk.applyFloors(text, parsed));
    } catch (e) {
      console.error('[analyze] attempt failed:', e && e.message);
    }
  }

  // Every AI provider failed: answer with the local rules so the caller still gets a rating.
  const local = Risk.analyzeRisk(text);
  return res.status(200).json({ score: local.score, level: local.level, flagged: local.flagged, reasons: local.reasons, aiUnavailable: true });
};
