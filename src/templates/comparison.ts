interface ComparisonData {
  title: string;
  type: string;
  options: Array<{
    name: string;
    price?: string;
    rating?: number;
    location?: string;
    highlights: string[];
    bookingUrl?: string;
    recommended?: boolean;
    recommendReason?: string;
  }>;
  userPhone: string;
}

export function renderComparisonPage(data: ComparisonData): string {
  const optionsHtml = data.options.map((option, idx) => {
    const highlightsHtml = option.highlights
      .map((h) => `<li>${escapeHtml(h)}</li>`)
      .join('');

    const recommendBadge = option.recommended
      ? `<div class="recommend-badge">⭐ Recommended${option.recommendReason ? `: ${escapeHtml(option.recommendReason)}` : ''}</div>`
      : '';

    const bookBtn = option.bookingUrl
      ? `<a href="${escapeHtml(option.bookingUrl)}" class="book-btn">Book This</a>`
      : '';

    return `<div class="option-card${option.recommended ? ' recommended' : ''}">
      ${recommendBadge}
      <div class="option-header">
        <h3>${escapeHtml(option.name)}</h3>
        ${option.price ? `<div class="option-price">${escapeHtml(option.price)}</div>` : ''}
      </div>
      <div class="option-meta">
        ${option.rating ? `<span class="rating">⭐ ${option.rating}</span>` : ''}
        ${option.location ? `<span class="location">📍 ${escapeHtml(option.location)}</span>` : ''}
      </div>
      ${highlightsHtml ? `<ul class="highlights">${highlightsHtml}</ul>` : ''}
      ${bookBtn}
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(data.title)} — Destinx</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f7fa;color:#1a1a2e;line-height:1.5}
.container{max-width:480px;margin:0 auto;padding:16px}
.hero{background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;padding:24px 20px;border-radius:16px;margin-bottom:20px;text-align:center}
.hero h1{font-size:20px}
.hero .subtitle{opacity:0.9;font-size:14px;margin-top:4px}
.option-card{background:white;border-radius:12px;padding:16px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08);border:2px solid transparent}
.option-card.recommended{border-color:#667eea;box-shadow:0 2px 8px rgba(102,126,234,0.2)}
.recommend-badge{background:#667eea;color:white;font-size:12px;padding:4px 10px;border-radius:8px;display:inline-block;margin-bottom:8px;font-weight:500}
.option-header{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
.option-header h3{font-size:16px;flex:1}
.option-price{font-size:18px;font-weight:700;color:#27ae60;white-space:nowrap}
.option-meta{display:flex;gap:12px;margin:8px 0;font-size:13px;color:#666}
.highlights{padding-left:20px;margin:8px 0}
.highlights li{font-size:13px;margin-bottom:2px;color:#555}
.book-btn{display:block;text-align:center;background:#667eea;color:white;padding:10px;border-radius:10px;font-size:15px;text-decoration:none;font-weight:600;margin-top:12px}
.footer{text-align:center;padding:20px;font-size:12px;color:#aaa}
</style>
</head>
<body>
<div class="container">
  <div class="hero">
    <h1>${escapeHtml(data.title)}</h1>
    <div class="subtitle">Compare ${data.options.length} options</div>
  </div>
  ${optionsHtml}
  <div class="footer">Powered by Destinx ✈️</div>
</div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
