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

Extract ONLY what is visibly printed on this page. Do NOT invent or add anything.

The page structure is always:
1. Title (bold heading at top)
2. Scripture/Maandiko block — a Bible reference + verse (sometimes absent)
3. Body text — paragraphs between scripture and prayers (sometimes absent)
4. Prayer/Sala/Maombi — the main prayer text (almost always present)

Return ONLY valid JSON, no markdown, no explanation:
{
  "day": <integer day of month>,
  "monthNumber": <integer 1-12>,
  "month": "<English month name>",
  "date": "<e.g. March 18>",
  "title": "<bold title at top of page>",
  "scripture": "<Bible reference if present, e.g. Warumi 8:37 (SUV) — empty string if absent>",
  "scriptureText": "<the Bible verse text if present — empty string if absent>",
  "bodyText": "<paragraphs between scripture and prayer if present — empty string if absent>",
  "prayer": "<full prayer/Sala/Maombi text — empty string if not on this page>"
}

Rules:
- Use empty string "" for any field not visible on this page.
- bodyText is ONLY the paragraphs that come after the scripture and before the prayer.
- Do not include section heading words like Tuombe, Maombi, Sala in the prayer field — just the prayer text itself.
- scripture is only a Bible citation block, not general text.`
          }
        ]
      }]
    })
  });

  const data = await response.json();
  res.json(data);
}
