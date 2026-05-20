// POST /api/lead-status — оновлює статус однієї заявки у status.json (всередині приватного Gist).
// Body: { id, contactStatus?, saleStatus?, comment? }
import { checkAuth, fetchGist, gistFiles, patchGistFile } from './_gist.js';

const CONTACT = ['new', 'reached', 'noanswer'];
const SALE = ['none', 'thinking', 'bought', 'rejected'];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = checkAuth(req);
  if (!auth.ok) return res.status(auth.code).json({ error: auth.error });

  const { id, contactStatus, saleStatus, comment, deleted } = req.body || {};
  if (!id) return res.status(400).json({ error: 'Missing id' });
  if (contactStatus !== undefined && !CONTACT.includes(contactStatus))
    return res.status(400).json({ error: 'Bad contactStatus' });
  if (saleStatus !== undefined && !SALE.includes(saleStatus))
    return res.status(400).json({ error: 'Bad saleStatus' });
  if (deleted !== undefined && typeof deleted !== 'boolean')
    return res.status(400).json({ error: 'Bad deleted' });

  try {
    const gist = await fetchGist();
    const files = gistFiles();
    const statusRaw = gist.files?.[files.status]?.content || '{}';

    let statuses = {};
    try {
      statuses = JSON.parse(statusRaw);
    } catch {
      statuses = {};
    }

    const prev = statuses[id] || {};
    const next = { ...prev };
    if (contactStatus !== undefined) next.contactStatus = contactStatus;
    if (saleStatus !== undefined) next.saleStatus = saleStatus;
    if (comment !== undefined) next.comment = String(comment).slice(0, 2000);
    if (deleted !== undefined) next.deleted = deleted;
    next.updatedAt = new Date().toISOString();
    statuses[id] = next;

    await patchGistFile(files.status, JSON.stringify(statuses, null, 2));

    return res.status(200).json({ ok: true, status: next });
  } catch (e) {
    console.error('lead-status error:', e.message);
    return res.status(502).json({ error: e.message });
  }
}
