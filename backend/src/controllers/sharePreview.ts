import type { Request, Response } from 'express';
import { validateAddress } from '../validation.js';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char] ?? char);
}

export function createSharePreviewController() {
  return (req: Request, res: Response) => {
    let recipient: string;
    try {
      recipient = validateAddress(req.params.recipient);
    } catch {
      return res.status(400).type('text/plain').send('Invalid Stellar address');
    }

    const frontendUrl = (process.env.FRONTEND_URL ?? `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    const pageUrl = `${frontendUrl}/view/${encodeURIComponent(recipient)}`;
    const title = `Vesting stream for ${recipient}`;
    const description = `View the vesting schedule, cliff, and token release timeline for ${recipient}.`;
    const imageUrl = process.env.PUBLIC_OG_IMAGE_URL ?? `${frontendUrl}/stream-share-preview.svg`;
    const safePageUrl = escapeHtml(pageUrl);

    res
      .status(200)
      .type('html')
      .send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:image" content="${escapeHtml(imageUrl)}">
  <meta property="og:url" content="${escapeHtml(`${req.protocol}://${req.get('host')}${req.originalUrl}`)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta http-equiv="refresh" content="0;url=${safePageUrl}">
</head>
<body>
  <p>Opening <a href="${safePageUrl}">the shared vesting stream</a>…</p>
</body>
</html>`);
  };
}