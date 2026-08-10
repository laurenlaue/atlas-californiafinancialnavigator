// Receives pasted financial aid award letter text from the Compass app and
// asks Claude to extract the handful of dollar figures the Offers &
// Affordability page needs, so a family doesn't have to type them by hand.
//
// Requires an ANTHROPIC_API_KEY environment variable set in the Netlify
// site's settings (Site configuration -> Environment variables). The key
// only ever lives here, server-side — it is never sent to the browser.
//
// COST PROTECTION: this app has no accounts/login, so this endpoint is
// reachable by anyone, not just people using the form. Input length and
// output tokens are both capped below to bound the cost of any single
// call. The real backstop against a runaway bill is a hard spending cap
// set in the Anthropic console (console.anthropic.com -> Settings ->
// Billing) — that's the guarantee that can't be bypassed by a bug here.

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-5"; // update if your Anthropic account uses a different model id
const MAX_INPUT_CHARS = 20000;

exports.handler = async (event) => {
  const headers = {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Server not configured — missing ANTHROPIC_API_KEY." }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid request body." }) };
  }

  const text = String(payload.text || "").slice(0, MAX_INPUT_CHARS).trim();
  if (!text) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "No letter text provided." }) };
  }

  const prompt = [
    "You are extracting structured numbers from a U.S. college financial aid award letter.",
    "Read the letter text below and extract these fields. If a field is not present or unclear, use null — never guess.",
    "",
    "Return ONLY valid JSON, no markdown fences, no other text, matching exactly this shape:",
    '{"college": string|null, "coa": number|null, "grants": number|null, "scholarships": number|null, "workStudy": number|null, "loans": number|null, "parentPlus": number|null}',
    "",
    "Field meanings:",
    "- coa: total cost of attendance for one year (tuition + housing + food + other, the full sticker price before any aid).",
    "- grants: need-based grants (federal Pell, state grants like Cal Grant) — money that never has to be repaid. Do not include loans here.",
    "- scholarships: merit or other scholarships from the school or outside sources — also never repaid.",
    "- workStudy: work-study award amount (money the student has to earn by working).",
    "- loans: student federal/direct loans only.",
    "- parentPlus: Parent PLUS loans or other private/parent loans.",
    "- All amounts are per year. If the letter shows a multi-year or 4-year total, use the first year's figure only.",
    "- If a letter lists several grants or scholarships as separate line items, sum them into the one matching field.",
    "",
    "Letter text:",
    '"""',
    text,
    '"""',
  ].join("\n");

  try {
    const resp = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      return { statusCode: 502, headers, body: JSON.stringify({ error: "AI request failed.", detail: detail.slice(0, 500) }) };
    }

    const data = await resp.json();
    const raw = (data && data.content && data.content[0] && data.content[0].text) || "";
    const match = raw.match(/\{[\s\S]*\}/);
    let parsed;
    try {
      parsed = JSON.parse(match ? match[0] : raw);
    } catch (e) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: "Could not understand the AI's response." }) };
    }

    const clean = (v) => (typeof v === "number" && isFinite(v) ? v : null);
    const result = {
      college: typeof parsed.college === "string" ? parsed.college.slice(0, 200) : null,
      coa: clean(parsed.coa),
      grants: clean(parsed.grants),
      scholarships: clean(parsed.scholarships),
      workStudy: clean(parsed.workStudy),
      loans: clean(parsed.loans),
      parentPlus: clean(parsed.parentPlus),
    };

    return { statusCode: 200, headers, body: JSON.stringify({ result }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Unexpected server error." }) };
  }
};
