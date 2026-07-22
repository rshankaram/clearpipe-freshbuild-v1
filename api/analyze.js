const SYSTEM_PROMPT = `You are ClearPipe, a deal intelligence assistant for Indian B2B sales reps.

Your job is to help a rep read one live deal clearly. You are calm, direct, specific, and practical. You do not sound clever. You do not sound like a chatbot. You do not use validation-heavy or permission-seeking language.

The product flow is simple:
1. The rep submits the first screen.
2. Background analysis begins immediately.
3. The second screen sharpens the read.
4. The rep may add one correction or missing fact.
5. You produce one calibrated read.

Return valid JSON only. No markdown fences.

Expected input fields:
- requestType: initial_read or calibrated_read
- companyName
- dealName
- dealValue
- dealStage
- dealStatus
- conversationDriver
- primaryContactName
- primaryContactDesignation
- buyerActions
- pricingRaisedByBuyer
- metSomeoneSenior
- winningRead
- painUrgency
- biggestConcern
- whatFeelsRight
- calibrationText
- initialResponse

Reasoning rules:
- Separate what is established from what is inferred.
- Do not state an inference as fact.
- If the strongest read depends on missing evidence, say so plainly.
- Trust contradictions inside the rep’s own answers.
- dealStatus is the source of truth for whether the deal is alive. Never imply the deal is closed, dead, or over if dealStatus is Moving, Stuck, or Paused.
- Price not coming up is useful, but it does not prove the buyer is not serious.
- If the primary contact is clearly senior, do not invent a seniority gap just because no one else has been met.
- If there is no clear competitor evidence, do not invent one.
- Keep the language conversational and plain.

Output schema:
{
  "seeing": "string",
  "worthKnowing": "string",
  "watchOutForThis": "string",
  "nextConversation": "string",
  "confidenceBand": "High" | "Medium" | "Low",
  "confidenceReason": "string"
}

Field guidance:
- seeing: one short paragraph.
- worthKnowing: one short paragraph.
- watchOutForThis: one short paragraph only if a specific risk is real, otherwise empty string.
- nextConversation: 2 or 3 numbered items, plain text, tightly tied to this deal.
- confidenceBand: one of High, Medium, Low.
- confidenceReason: one short paragraph explaining why.

If requestType is calibrated_read:
- Use calibrationText as fresh ground reality.
- Update the read instead of repeating it.
- Do not add thanks or validation.

Avoid these phrases:
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
    requestType: body.requestType === 'calibrated_read' ? 'calibrated_read' : 'initial_read',
    companyName: sanitizeString(body.companyName, 200),
    dealName: sanitizeString(body.dealName, 200),
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
    initialResponse: body && typeof body.initialResponse === 'object' ? {
      seeing: sanitizeString(body.initialResponse.seeing, 3000),
      worthKnowing: sanitizeString(body.initialResponse.worthKnowing, 3000),
      watchOutForThis: sanitizeString(body.initialResponse.watchOutForThis, 3000),
      nextConversation: sanitizeString(body.initialResponse.nextConversation, 3000),
      confidenceBand: sanitizeString(body.initialResponse.confidenceBand, 20),
      confidenceReason: sanitizeString(body.initialResponse.confidenceReason, 3000)
    } : null
  };
}

function validateInput(input) {
  const required = ['companyName', 'dealName', 'dealValue', 'dealStage', 'dealStatus', 'conversationDriver', 'primaryContactName', 'primaryContactDesignation', 'pricingRaisedByBuyer', 'metSomeoneSenior', 'winningRead', 'painUrgency'];
  const missing = required.filter(key => !input[key]);
  if (missing.length) return `Missing required fields: ${missing.join(', ')}`;
  if (input.requestType === 'calibrated_read' && !input.calibrationText) return 'A correction or missing fact is required for a calibrated read.';
  return null;
}

function normalizeOutput(parsed) {
  const band = ['High', 'Medium', 'Low'].includes(parsed.confidenceBand) ? parsed.confidenceBand : 'Medium';
  return {
    seeing: sanitizeString(parsed.seeing, 3000),
    worthKnowing: sanitizeString(parsed.worthKnowing, 3000),
    watchOutForThis: sanitizeString(parsed.watchOutForThis, 3000),
    nextConversation: sanitizeString(parsed.nextConversation, 3000),
    confidenceBand: band,
    confidenceReason: sanitizeString(parsed.confidenceReason, 3000)
  };
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
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  const input = buildInput(body || {});
  const validationError = validateInput(input);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
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

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error('Anthropic API error:', anthropicRes.status, errText);
      res.status(502).json({ error: 'The analysis service returned an error. Please try again in a moment.' });
      return;
    }

    const anthropicData = await anthropicRes.json();
    const textBlock = Array.isArray(anthropicData.content)
      ? anthropicData.content.find(block => block && block.type === 'text' && typeof block.text === 'string')
      : null;

    const rawText = textBlock ? textBlock.text.trim() : '';
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('Model did not return JSON:', rawText);
      res.status(502).json({ error: 'Could not parse the analysis. Please try again.' });
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (error) {
      console.error('Failed to parse model JSON:', error, rawText);
      res.status(502).json({ error: 'Could not parse the analysis. Please try again.' });
      return;
    }

    res.status(200).json(normalizeOutput(parsed));
  } catch (error) {
    console.error('Unexpected server error:', error);
    res.status(500).json({ error: 'Unexpected server error. Please try again.' });
  }
}
