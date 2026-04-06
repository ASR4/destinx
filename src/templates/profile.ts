interface ProfileData {
  userName: string;
  preferences: Array<{
    category: string;
    key: string;
    value: unknown;
    confidence: number;
  }>;
  trips: Array<{
    destination: string;
    startDate: string;
    endDate: string;
    status: string;
  }>;
}

const CATEGORY_LABELS: Record<string, { label: string; icon: string }> = {
  accommodation: { label: 'Accommodation', icon: '🏨' },
  food: { label: 'Food & Dining', icon: '🍽️' },
  transport: { label: 'Transport', icon: '✈️' },
  budget: { label: 'Budget', icon: '💰' },
  travel_style: { label: 'Travel Style', icon: '🎒' },
  loyalty: { label: 'Loyalty Programs', icon: '⭐' },
  dietary: { label: 'Dietary', icon: '🥗' },
  companion: { label: 'Travel Companions', icon: '👥' },
};

function confidenceLabel(conf: number): { text: string; color: string } {
  if (conf > 0.7) return { text: 'Strong', color: '#27ae60' };
  if (conf >= 0.4) return { text: 'Observed', color: '#f39c12' };
  return { text: 'Tentative', color: '#95a5a6' };
}

export function renderProfilePage(data: ProfileData): string {
  const grouped = new Map<string, typeof data.preferences>();
  for (const pref of data.preferences) {
    if (!grouped.has(pref.category)) grouped.set(pref.category, []);
    grouped.get(pref.category)!.push(pref);
  }

  const categoriesHtml = Array.from(grouped.entries()).map(([category, prefs]) => {
    const meta = CATEGORY_LABELS[category] ?? { label: category, icon: '📌' };
    const prefsHtml = prefs.map((p) => {
      const conf = confidenceLabel(p.confidence);
      const val = typeof p.value === 'string' ? p.value : JSON.stringify(p.value);
      return `<div class="pref-item">
        <div class="pref-key">${escapeHtml(p.key.replace(/_/g, ' '))}</div>
        <div class="pref-value">${escapeHtml(val)}</div>
        <div class="pref-confidence" style="color:${conf.color}">${conf.text}</div>
      </div>`;
    }).join('');

    return `<div class="category-card">
      <h3>${meta.icon} ${meta.label}</h3>
      ${prefsHtml}
    </div>`;
  }).join('');

  const tripsHtml = data.trips.length > 0
    ? `<div class="section">
        <h2>🗺️ Past Trips</h2>
        ${data.trips.map((t) => `<div class="trip-item">
          <span class="trip-dest">${escapeHtml(t.destination)}</span>
          <span class="trip-dates">${escapeHtml(t.startDate)} → ${escapeHtml(t.endDate)}</span>
          <span class="trip-status">${escapeHtml(t.status)}</span>
        </div>`).join('')}
      </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Travel DNA — ${escapeHtml(data.userName)} — Destinx</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f7fa;color:#1a1a2e;line-height:1.5}
.container{max-width:480px;margin:0 auto;padding:16px}
.hero{background:linear-gradient(135deg,#f093fb 0%,#f5576c 100%);color:white;padding:32px 20px;border-radius:16px;margin-bottom:20px;text-align:center}
.hero h1{font-size:22px;margin-bottom:4px}
.hero .subtitle{opacity:0.9;font-size:14px}
.category-card{background:white;border-radius:12px;padding:16px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08)}
.category-card h3{font-size:16px;margin-bottom:12px;color:#333}
.pref-item{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #f5f5f5;flex-wrap:wrap}
.pref-item:last-child{border-bottom:none}
.pref-key{font-size:13px;color:#888;min-width:120px;text-transform:capitalize}
.pref-value{font-size:14px;font-weight:500;flex:1}
.pref-confidence{font-size:11px;padding:2px 8px;border-radius:8px;background:#f8f9fa}
.section{background:white;border-radius:12px;padding:16px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08)}
.section h2{font-size:16px;margin-bottom:12px}
.trip-item{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #f5f5f5;font-size:14px;flex-wrap:wrap}
.trip-item:last-child{border-bottom:none}
.trip-dest{font-weight:600;min-width:100px}
.trip-dates{color:#888;font-size:13px;flex:1}
.trip-status{font-size:11px;background:#e8f5e9;color:#2e7d32;padding:2px 8px;border-radius:8px;text-transform:capitalize}
.footer{text-align:center;padding:20px;font-size:12px;color:#aaa}
.edit-note{text-align:center;font-size:13px;color:#888;margin-bottom:16px;padding:12px;background:white;border-radius:12px}
</style>
</head>
<body>
<div class="container">
  <div class="hero">
    <h1>✨ Your Travel DNA</h1>
    <div class="subtitle">${escapeHtml(data.userName)}</div>
  </div>
  <div class="edit-note">Send me a WhatsApp message to update any preference!</div>
  ${categoriesHtml}
  ${tripsHtml}
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
