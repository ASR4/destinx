interface ItineraryData {
  destination: string;
  startDate: string;
  endDate: string;
  status: string;
  plan: {
    days?: Array<{
      date: string;
      day_number: number;
      theme?: string;
      items: Array<{
        time: string;
        type: string;
        name: string;
        description?: string;
        duration_min?: number;
        price?: { amount: number; currency: string };
        booking_url?: string;
        maps_url?: string;
        rating?: number;
        notes?: string;
      }>;
      accommodation?: {
        name: string;
        check_in?: boolean;
        check_out?: boolean;
        loyalty_program?: string;
      };
      day_total?: { amount: number; currency: string };
    }>;
    overview?: string;
    packing_tips?: string[];
    important_notes?: string[];
  };
  budget?: { total: number; currency: string };
  travelers?: Array<{ name: string; age?: number }>;
}

const TYPE_ICONS: Record<string, string> = {
  flight: '✈️',
  hotel: '🏨',
  restaurant: '🍽️',
  experience: '🎭',
  transport: '🚕',
  free_time: '☀️',
};

export function renderItineraryPage(data: ItineraryData): string {
  const days = data.plan?.days ?? [];
  const totalCost = days.reduce((sum, d) => {
    if (d.day_total) return sum + d.day_total.amount;
    return sum + d.items.reduce((s, i) => s + (i.price?.amount ?? 0), 0);
  }, 0);

  const daysHtml = days.map((day) => {
    const itemsHtml = day.items.map((item) => {
      const icon = TYPE_ICONS[item.type] ?? '📌';
      const priceStr = item.price ? `<span class="price">${item.price.currency} ${item.price.amount}</span>` : '';
      const ratingStr = item.rating ? `<span class="rating">⭐ ${item.rating}</span>` : '';
      const linkHtml = item.booking_url ? `<a href="${escapeHtml(item.booking_url)}" class="cta-btn">Book</a>` : '';
      const mapsHtml = item.maps_url ? `<a href="${escapeHtml(item.maps_url)}" class="maps-link">📍 Map</a>` : '';

      return `<div class="item">
        <div class="item-time">${escapeHtml(item.time)}</div>
        <div class="item-content">
          <div class="item-header">
            <span class="item-icon">${icon}</span>
            <span class="item-name">${escapeHtml(item.name)}</span>
            ${ratingStr}
            ${priceStr}
          </div>
          ${item.description ? `<div class="item-desc">${escapeHtml(item.description)}</div>` : ''}
          ${item.notes ? `<div class="item-notes">${escapeHtml(item.notes)}</div>` : ''}
          <div class="item-actions">${linkHtml}${mapsHtml}</div>
        </div>
      </div>`;
    }).join('');

    const accomHtml = day.accommodation
      ? `<div class="accommodation">🏨 ${escapeHtml(day.accommodation.name)}${day.accommodation.loyalty_program ? ` <span class="loyalty">${escapeHtml(day.accommodation.loyalty_program)}</span>` : ''}</div>`
      : '';

    const dayTotalHtml = day.day_total
      ? `<div class="day-total">Day total: ${day.day_total.currency} ${day.day_total.amount}</div>`
      : '';

    return `<div class="day-card">
      <div class="day-header">
        <h2>Day ${day.day_number}</h2>
        <span class="day-date">${escapeHtml(day.date)}</span>
        ${day.theme ? `<span class="day-theme">${escapeHtml(day.theme)}</span>` : ''}
      </div>
      <div class="day-timeline">${itemsHtml}</div>
      ${accomHtml}
      ${dayTotalHtml}
    </div>`;
  }).join('');

  const tipsHtml = data.plan?.packing_tips?.length
    ? `<div class="section"><h2>🎒 Packing Tips</h2><ul>${data.plan.packing_tips.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul></div>`
    : '';

  const notesHtml = data.plan?.important_notes?.length
    ? `<div class="section"><h2>📋 Important Notes</h2><ul>${data.plan.important_notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul></div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(data.destination)} Itinerary — Destinx</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f7fa;color:#1a1a2e;line-height:1.5}
.container{max-width:480px;margin:0 auto;padding:16px}
.hero{background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;padding:32px 20px;border-radius:16px;margin-bottom:20px;text-align:center}
.hero h1{font-size:24px;margin-bottom:4px}
.hero .dates{opacity:0.9;font-size:14px}
.hero .status{display:inline-block;background:rgba(255,255,255,0.2);padding:4px 12px;border-radius:12px;font-size:12px;margin-top:8px;text-transform:uppercase}
.budget-bar{background:white;border-radius:12px;padding:16px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08)}
.budget-bar .label{font-size:13px;color:#666}
.budget-bar .amount{font-size:22px;font-weight:700;color:#1a1a2e}
.day-card{background:white;border-radius:12px;padding:16px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08)}
.day-header{display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap}
.day-header h2{font-size:18px;color:#667eea}
.day-date{font-size:13px;color:#888}
.day-theme{font-size:12px;background:#f0f0ff;color:#667eea;padding:2px 8px;border-radius:8px}
.item{display:flex;gap:12px;padding:10px 0;border-bottom:1px solid #f0f0f0}
.item:last-child{border-bottom:none}
.item-time{font-size:13px;color:#888;min-width:50px;font-weight:500}
.item-content{flex:1}
.item-header{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.item-icon{font-size:16px}
.item-name{font-weight:600;font-size:15px}
.price{font-size:13px;color:#27ae60;font-weight:500}
.rating{font-size:12px;color:#f39c12}
.item-desc{font-size:13px;color:#666;margin-top:4px}
.item-notes{font-size:12px;color:#888;margin-top:2px;font-style:italic}
.item-actions{margin-top:6px;display:flex;gap:8px}
.cta-btn{display:inline-block;background:#667eea;color:white;padding:6px 14px;border-radius:8px;font-size:13px;text-decoration:none;font-weight:500}
.maps-link{font-size:13px;color:#667eea;text-decoration:none;padding:6px 0}
.accommodation{font-size:13px;color:#555;margin-top:8px;padding-top:8px;border-top:1px solid #f0f0f0}
.loyalty{background:#fff3cd;color:#856404;padding:2px 6px;border-radius:4px;font-size:11px}
.day-total{font-size:13px;color:#27ae60;margin-top:6px;text-align:right;font-weight:500}
.section{background:white;border-radius:12px;padding:16px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08)}
.section h2{font-size:16px;margin-bottom:8px}
.section ul{padding-left:20px}
.section li{font-size:14px;margin-bottom:4px}
.footer{text-align:center;padding:20px;font-size:12px;color:#aaa}
</style>
</head>
<body>
<div class="container">
  <div class="hero">
    <h1>${escapeHtml(data.destination)}</h1>
    <div class="dates">${escapeHtml(data.startDate)} → ${escapeHtml(data.endDate)}</div>
    <div class="status">${escapeHtml(data.status)}</div>
  </div>
  ${data.plan?.overview ? `<div class="section"><p>${escapeHtml(data.plan.overview)}</p></div>` : ''}
  ${totalCost > 0 ? `<div class="budget-bar"><div class="label">Estimated total</div><div class="amount">${data.budget?.currency ?? 'USD'} ${totalCost.toLocaleString()}</div></div>` : ''}
  ${daysHtml}
  ${tipsHtml}
  ${notesHtml}
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
