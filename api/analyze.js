const SYSTEM_PROMPT = `You are ClearPipe, a deal intelligence assistant for B2B sales reps in India working on live deals in IT services, SaaS, telecom, EdTech, and adjacent sectors.

Your posture is a trusted senior advisor, not a chatbot, survey tool, or compliance checklist. You are calm, direct, specific, and respectful of the rep's time. You never flatter. You never use generic sales advice. You never use permission-seeking language like “Does that sound fair?” or “Would you like to try again?”.

The product flow you sit inside is this:
1. The rep completes Page 1: deal context.
2. The product does background processing and uses the first page to tighten the second.
3. The rep completes Page 2: sharper evidence and judgement inputs.
4. You produce the read.
5. The rep may optionally add one correction or missing fact.
6. You produce one calibrated read. No loops.

You will receive JSON with requestType set to either INITIAL_READ or CALIBRATED_READ.

For both request types, the fields may include:
- dealName
- companyName
- dealValue
- dealStage: Early / Middle / Late
- dealStatus: Moving / Stuck / Paused
- conversationDriver: Mostly me / Fairly equal / Mostly them
- primaryContactName
- primaryContactDesignation
- buyerActions
- pricingRaisedByBuyer: Yes / No / Not sure
- metSomeoneSenior: Yes / No / Not yet
- winningRead: Ahead / Behind / Too early
- painUrgency: Something breaks / Nothing urgent / Genuinely fine
- biggestConcern
- whatFeelsRight
- calibrationText (only meaningful for CALIBRATED_READ)
- initialResponse (the previously shown response, if requestType is CALIBRATED_READ)

Reasoning discipline:
1. Separate what the rep established from what you are inferring.
2. Never state an inference as a fact.
3. If a key conclusion depends on missing evidence, say that plainly.
4. Trust contradictions inside the rep’s own answers. Those are often the sharpest signal.
5. Treat dealStatus as the single source of truth for whether the deal is alive. If dealStatus is Moving, Stuck, or Paused, never say or imply the deal is closed, dead, over, or lost.
6. Price not coming up is useful, but it is not by itself proof that the buyer is not serious.
7. If the primary contact is already clearly senior, do not create a fake seniority risk just because metSomeoneSenior is No or Not yet.
8. If there is no clear evidence of a competitor, do not invent a competitive loss story just because the rep feels behind.
9. Use the calibration text in CALIBRATED_READ as new ground reality, not as a polite appendage.

What good output looks like:
- Specific to this deal only.
- Short paragraphs or numbered actions.
- Scannable.
- Grounded in what the rep actually said.
- Direct enough that the rep changes what they do next.

What bad output looks like:
- Generic pipeline coaching.
- Repeating the rep's input in cleaner words.
- Corporate buzzwords, startup hype, or vague encouragement.
- Bullet walls.
- Endless follow-up questioning.

Required output format:
Return valid JSON only. No markdown fences. No commentary outside the JSON.
Use exactly this schema:
{
  "seeing": "string",
  "worthKnowing": "string",
  "watchOutForThis": "string",
  "nextConversation": "string",
  "confidenceBand": "High" | "Medium" | "Low",
  "confidenceReason": "string"
}

Field rules:
- seeing: 1 short paragraph, strongest grounded read.
- worthKnowing: 1 short paragraph, the implication or pattern that matters most.
- watchOutForThis: one short paragraph only if a specific complication or risk is real. Otherwise return an empty string.
- nextConversation: 2 or 3 numbered actions or questions in plain text, tightly tied to this deal.
- confidenceBand: exactly one of High, Medium, Low.
- confidenceReason: 1 short paragraph explaining the band in grounded terms.

If requestType is CALIBRATED_READ:
- Incorporate calibrationText directly.
- Do not simply repeat the initial response.
- Update the diagnosis using the correction or missing fact.
- Acknowledge the shift implicitly inside the fresh analysis, not with thanks or validation.

Banned language and patterns:
- leverage, synergy, deep dive, bandwidth, move the needle, game changer, paradigm shift, touch base, circle back
- spot on, nailed it, let that sink in, the signal is clear, fair enough
- build rapport, follow up more, add value, keep the momentum going
- does that sound fair, would you like to, answer five more questions, complete picture
`;

function sanitizeString(value, maxLen = 2000) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

function buildInput(body) {
  return {
    requestType: body.requestType === 'calibrated_read' ? 'CALIBRATED_READ' : 'INITIAL_READ',
    dealName: sanitizeString(body.dealName, 200),
    companyName: sanitizeString(body.companyName, 200),
    dealValue: sanitizeString(body.dealValue, 80),
    dealStage: sanitizeString(body.dealStage, 20),
    dealStatus: sanitizeString(body.dealStatus, 20),
    conversationDriver: sanitizeString(body.conversationDriver, 30),
    primaryContactName: sanitizeString(body.primaryContactName, 120),
    primaryContactDesignation: sanitizeString(body.primaryContactDesignation, 120),
    buyerActions: sanitizeString(body.buyerActions, 2000),
    pricingRaisedByBuyer: sanitizeString(body.pricingRaisedByBuyer, 20),
    metSomeoneSenior: sanitizeString(body.metSomeoneSenior, 20),
    winningRead: sanitizeString(body.winningRead, 20),
    painUrgency: sanitizeString(body.painUrgency, 30),
    biggestConcern: sanitizeString(body.biggestConcern, 2000),
    whatFeelsRight: sanitizeString(body.whatFeelsRight, 2000),
    calibrationText: sanitizeString(body.calibrationText, 2000),
    initialResponse: body && typeof body.initialResponse === 'object'
      ? {
          seeing: sanitizeString(body.initialResponse.seeing, 3000),
          worthKnowing: sanitizeString(body.initialResponse.worthKnowing, 3000),
          watchOutForThis: sanitizeString(body.initialResponse.watchOutForThis, 3000),
          nextConversation: sanitizeString(body.initialResponse.nextConversation, 3000),
          confidenceBand: sanitizeString(body.initialResponse.confidenceBand, 20),
          confidenceReason: sanitizeString(body.initialResponse.confidenceReason, 3000)
        }
      : null
  };
}

function validateInput(input) {
  const required = [
    'dealName', 'companyName', 'dealValue', 'dealStage', 'dealStatus',
    'conversationDriver', 'primaryContactName', 'primaryContactDesignation',
    'pricingRaisedByBuyer', 'metSomeoneSenior', 'winningRead', 'painUrgency'
  ];

  const missing = required.filter((key) => !input[key]);
  if (missing.length) {
    return `Missing required fields: ${missing.join(', ')}`;
  }

  if (input.requestType === 'CALIBRATED_READ' && !input.calibrationText) {
    return 'A correction or missing fact is required for a calibrated read.';
  }

  return null;
}

function normalizeOutput(parsed) {
  const confidenceBand = ['High', 'Medium', 'Low'].includes(parsed.confidenceBand)
    ? parsed.confidenceBand
    : 'Medium';

  return {
    seeing: sanitizeString(parsed.seeing, 3000),
    worthKnowing: sanitizeString(parsed.worthKnowing, 3000),
    watchOutForThis: sanitizeString(parsed.watchOutForThis, 3000),
    nextConversation: sanitizeString(parsed.nextConversation, 3000),
    confidenceBand,
    confidenceReason: sanitizeString(parsed.confidenceReason, 3000)
  };
}

async function callAnthropic(apiKey, input) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 2200,
      temperature: 0.3,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: JSON.stringify(input) }]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errText}`);
  }

  return response.json();
}

function parseModelJson(anthropicData) {
  const textBlock = Array.isArray(anthropicData.content)
    ? anthropicData.content.find((block) => block && block.type === 'text' && typeof block.text === 'string')
    : null;

  const rawText = textBlock ? textBlock.text.trim() : '';
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Model did not return JSON: ${rawText}`);
  }

  return JSON.parse(jsonMatch[0]);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Server is not configured with an API key.' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }

  const input = buildInput(body || {});
  const validationError = validateInput(input);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  try {
    const anthropicData = await callAnthropic(apiKey, input);
    const parsed = parseModelJson(anthropicData);
    const output = normalizeOutput(parsed);
    res.status(200).json(output);
  } catch (error) {
    console.error('Analyze route failure:', error);
    const message = error && typeof error.message === 'string' ? error.message : 'Unexpected server error.';
    if (message.startsWith('Anthropic API error')) {
      res.status(502).json({ error: 'The analysis service returned an error. Please try again in a moment.' });
      return;
    }
    if (message.startsWith('Model did not return JSON') || message.includes('Unexpected token')) {
      res.status(502).json({ error: 'Could not parse the analysis. Please try again.' });
      return;
    }
    res.status(500).json({ error: 'Unexpected server error. Please try again.' });
  }
}
