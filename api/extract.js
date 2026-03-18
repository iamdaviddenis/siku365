export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { base64, fileType } = req.body;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: fileType, data: base64 }
          },
          {
            type: "text",
            text: `This page is from the Swahili devotional book "Siku 365 za Ushindi 2026" by Pastor Tony Osborn.

Extract ONLY what is visibly printed on this page. Do NOT invent or add anything not present.

Return ONLY valid JSON with no markdown, no explanation:
{
  "day": <integer day of month, e.g. 18>,
  "monthNumber": <integer 1-12>,
  "month": "<English month name>",
  "date": "<e.g. March 18>",
  "title": "<the prayer/section title in bold at the top>",
  "scripture": "<scripture reference if present, e.g. Warumi 8:37 — empty string if not on this page>",
  "scriptureText": "<the scripture verse text if present — empty string if not on this page>",
  "bodyLabel": "<the exact section heading before the body text, e.g. Tafakari, Neno, Maombi ya Ukiri, Declarations — empty string if no such heading exists>",
  "bodyText": "<the body/devotional text under that heading — empty string if not present>",
  "prayer": "<the full prayer or Sala text — empty string if not on this page>"
}

Important rules:
- If a field is not visible on this page, use empty string.
- bodyLabel must be the EXACT heading word(s) printed on the page, not a translation.
- If there is no heading before the body text, leave bodyLabel as empty string.
- scripture and scriptureText are only for a Bible verse citation block, not general text.`
          }
        ]
      }]
    })
  });

  const data = await response.json();
  res.json(data);
}
