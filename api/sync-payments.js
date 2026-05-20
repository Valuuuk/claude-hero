// POST /api/sync-payments — читає список оплат із Google-таблиці (CSV-експорт),
// матчить із заявками за email / телефоном / telegram і ставить статус "Купив".
// Лише додає (ніколи не знімає bought). Токен GitHub лишається у Vercel.
import { checkAuth, fetchGist, gistFiles, parseLeads, patchGistFile } from './_gist.js';

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

const normPhone = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length >= 9 ? d.slice(-9) : ''; };
const normEmail = (e) => String(e || '').trim().toLowerCase();
const normTg = (s) => { const m = String(s || '').match(/(?:t\.me\/|@)([A-Za-z0-9_]+)/i); return m ? m[1].toLowerCase() : ''; };

function leadIdentity(l) {
  const f = l.fields;
  const emailFromContact = /@/.test(l.contact) && !/^@/.test(l.contact) ? l.contact : '';
  return {
    email: normEmail(f.Email || emailFromContact),
    phone: normPhone(f['Телефон']),
    tg: normTg(f.Telegram || l.contact),
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const auth = checkAuth(req);
  if (!auth.ok) return res.status(auth.code).json({ error: auth.error });

  try {
    const csvUrl = process.env.PAYERS_CSV_URL || DEFAULT_CSV;
    const csvR = await fetch(csvUrl);
    if (!csvR.ok) throw new Error(`CSV ${csvR.status}`);
    const rows = parseCSV(await csvR.text());
    rows.shift(); // header
    const payers = rows
      .filter((r) => r.length >= 4)
      .map((r) => ({
        name: (r[1] || '').trim(),
        email: normEmail(r[2]),
        phone: normPhone(r[3]),
        tariff: (r[4] || '').trim(),
        tg: normTg(r[6]),
      }));

    const gist = await fetchGist();
    const files = gistFiles();
    const md = gist.files?.[files.leads]?.content || '';
    let statuses = {};
    try { statuses = JSON.parse(gist.files?.[files.status]?.content || '{}'); } catch { statuses = {}; }

    const leads = parseLeads(md).map((l) => ({ id: l.id, contact: l.contact, ...leadIdentity(l) }));

    const matched = [];
    const unmatched = [];
    for (const p of payers) {
      const hit = leads.find((l) =>
        (p.email && l.email && l.email === p.email) ||
        (p.phone && l.phone && l.phone === p.phone) ||
        (p.tg && l.tg && l.tg === p.tg)
      );
      if (!hit) { unmatched.push(p.name); continue; }
      const by = p.email && hit.email === p.email ? 'email' : p.phone && hit.phone === p.phone ? 'phone' : 'telegram';
      statuses[hit.id] = {
        ...(statuses[hit.id] || {}),
        saleStatus: 'bought',
        deleted: false,
        paidName: p.name,
        paidTariff: p.tariff,
        paidVia: by,
        updatedAt: new Date().toISOString(),
      };
      matched.push({ payer: p.name, lead: hit.contact, by, tariff: p.tariff });
    }

    await patchGistFile(files.status, JSON.stringify(statuses, null, 2));

    return res.status(200).json({
      ok: true,
      payers: payers.length,
      matchedCount: matched.length,
      matched,
      unmatchedCount: unmatched.length,
      unmatched,
    });
  } catch (e) {
    console.error('sync-payments error:', e.message);
    return res.status(502).json({ error: e.message });
  }
}
