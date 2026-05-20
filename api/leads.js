// GET /api/leads — повертає всі заявки з leads.md, змерджені зі статусами зі status.json.
import { checkAuth, fetchGist, gistFiles, parseLeads } from './_gist.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = checkAuth(req);
  if (!auth.ok) return res.status(auth.code).json({ error: auth.error });

  try {
    const gist = await fetchGist();
    const files = gistFiles();
    const md = gist.files?.[files.leads]?.content || '';
    const statusRaw = gist.files?.[files.status]?.content || '{}';

    let statuses = {};
    try {
      statuses = JSON.parse(statusRaw);
    } catch {
      statuses = {};
    }

    const leads = parseLeads(md).map((lead) => ({
      ...lead,
      status: statuses[lead.id] || null,
    }));

    // Найновіші — згори.
    leads.reverse();

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ leads, count: leads.length });
  } catch (e) {
    console.error('leads error:', e.message);
    return res.status(502).json({ error: e.message });
  }
}
