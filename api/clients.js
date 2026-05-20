// GET /api/clients — повертає всіх, хто оплатив, із Google-таблиці (CSV-експорт).
// Окремий "реєстр клієнтів", не впливає на статистику по заявках.
import { checkAuth } from './_gist.js';

const DEFAULT_CSV =
  'https://docs.google.com/spreadsheets/d/1DB_TI0stLf57xpStSmUG49AZxLvHAEpl/export?format=csv';

function parseCSV(t) {
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else {
      if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && t[i + 1] === '\n') i++;
        if (cur !== '' || row.length) { row.push(cur); rows.push(row); row = []; cur = ''; }
      } else cur += c;
    }
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

function tariffGroup(t) {
  const s = String(t || '').toLowerCase();
  if (s.includes('ронін') || s.includes('ronin')) return 'Ронін';
  if (s.includes('майстер') || s.includes('master')) return 'Майстер';
  if (s.includes('самур') || s.includes('samur')) return 'Самурай';
  return t ? 'Інше' : '—';
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const auth = checkAuth(req);
  if (!auth.ok) return res.status(auth.code).json({ error: auth.error });

  try {
    const csvUrl = process.env.PAYERS_CSV_URL || DEFAULT_CSV;
    const r = await fetch(csvUrl);
    if (!r.ok) throw new Error(`CSV ${r.status}`);
    const rows = parseCSV(await r.text());
    rows.shift(); // header
    const clients = rows
      .filter((row) => (row[1] || row[2] || row[3] || '').trim())
      .map((row, i) => ({
        n: (row[0] || String(i + 1)).trim(),
        name: (row[1] || '').trim(),
        email: (row[2] || '').trim(),
        phone: (row[3] || '').trim(),
        tariff: (row[4] || '').trim(),
        tariffGroup: tariffGroup(row[4]),
        source: (row[5] || '').trim(),
        tg: (row[6] || '').trim(),
      }));

    const byTariff = {};
    for (const c of clients) byTariff[c.tariffGroup] = (byTariff[c.tariffGroup] || 0) + 1;

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ clients, count: clients.length, byTariff });
  } catch (e) {
    console.error('clients error:', e.message);
    return res.status(502).json({ error: e.message });
  }
}
