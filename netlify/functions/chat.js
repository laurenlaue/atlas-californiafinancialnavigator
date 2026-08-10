// Powers the "Ask a Question" chat assistant in Compass — a general-purpose
// financial-aid Q&A helper (FAFSA, state aid, scholarships, comparing
// offers, etc). Separate from parse-award-letter.js, which does structured
// extraction from a pasted award letter; this function recommends that tool
// when relevant instead of trying to replicate it in free-form chat.
//
// Requires an ANTHROPIC_API_KEY environment variable set in the Netlify
// site's settings (Site configuration -> Environment variables). The key
// only ever lives here, server-side — it is never sent to the browser.
//
// COST PROTECTION: message length, history length, and output tokens are
// all capped below to bound the cost of any single call. The real backstop
// against a runaway bill is a hard spending cap set in the Anthropic
// console (console.anthropic.com -> Settings -> Billing) — that's the
// guarantee that can't be bypassed by a bug here.

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-5"; // update if your Anthropic account uses a different model id
const MAX_MESSAGE_CHARS = 4000;
const MAX_HISTORY_MESSAGES = 20; // only the most recent N messages are sent, to bound token growth in long chats

const SYSTEM_PROMPT = [
  "You are the \"Ask a Question\" assistant inside Compass, a free California college financial-aid app for students and families.",
  "Answer questions about FAFSA, CADAA, California state aid (Cal Grant, Chafee, Middle Class Scholarship), scholarships, comparing financial aid offers, student loans, and related topics.",
  "Keep answers concise and plain-English — a few short paragraphs at most, not an essay.",
  "You are not a licensed financial, legal, or immigration advisor. For anything with real stakes (a specific family's eligibility, appeals, unusual situations), tell the user to confirm with their school's financial aid office or an official source, not just rely on you.",
  "If the user describes having a real financial aid award/offer letter they want help reading or comparing, tell them Compass has a dedicated tool for that on this same page — the \"Have a real award letter?\" box below the chat, where AI reads the letter and fills in the numbers on the Offers & Affordability page for them.",
  "If a question is outside financial aid for college (unrelated topics), politely redirect back to what you can help with.",
].join(" ");

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

  const incoming = Array.isArray(payload.messages) ? payload.messages : [];
  const messages = incoming
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }));

  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "No user message provided." }) };
  }

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
        max_tokens: 700,
        system: SYSTEM_PROMPT,
        messages,
      }),
    });

    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      return { statusCode: 502, headers, body: JSON.stringify({ error: "AI request failed.", detail: detail.slice(0, 500) }) };
    }
    const data = await resp.json();
   const textBlock = (data && Array.isArray(data.content)) ? data.content.find((b) => b && b.type === "text") : null;
const reply = (textBlock && textBlock.text) || "";
    if (!reply.trim()) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: "Empty response from AI." }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ reply: reply.trim() }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Unexpected server error." }) };
  }
};
