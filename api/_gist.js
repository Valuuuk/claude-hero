// Спільні хелпери для CRM: робота з приватним Gist (leads.md + status.json) і парсинг заявок.

const GH = {
  token: () => process.env.GITHUB_TOKEN,
  gistId: () => process.env.GIST_ID,
  leadsFile: () => process.env.GIST_FILENAME || 'leads.md',
  statusFile: () => process.env.STATUS_FILENAME || 'status.json',
};

export function checkAuth(req) {
  const expected = process.env.CRM_PASSWORD;
  if (!expected) return { ok: false, code: 500, error: 'CRM_PASSWORD not configured' };
  const auth = req.headers.authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (token !== expected) return { ok: false, code: 401, error: 'Unauthorized' };
  return { ok: true };
}

export async function fetchGist() {
  const token = GH.token();
  const gistId = GH.gistId();
  if (!token || !gistId) throw new Error('GITHUB_TOKEN / GIST_ID not configured');
  const r = await fetch(`https://api.github.com/gists/${gistId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'claude-hero-crm',
    },
  });
  if (!r.ok) throw new Error(`Gist GET ${r.status}: ${await r.text()}`);
  return r.json();
}

export async function patchGistFile(filename, content) {
  const token = GH.token();
  const gistId = GH.gistId();
  const r = await fetch(`https://api.github.com/gists/${gistId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'claude-hero-crm',
    },
    body: JSON.stringify({ files: { [filename]: { content } } }),
  });
  if (!r.ok) throw new Error(`Gist PATCH ${r.status}: ${await r.text()}`);
}

export function gistFiles() {
  return { leads: GH.leadsFile(), status: GH.statusFile() };
}

// Парсимо markdown-архів leads.md у масив структурованих заявок.
// Підтримує обидва формати: старий (Мета/Блокери) і новий (Біль/Результат-вау).
export function parseLeads(md) {
  if (!md) return [];
  const blocks = md.split(/\n## /).slice(1); // [0] — заголовок файлу
  const leads = [];

  for (const raw of blocks) {
    const lines = raw.split('\n');
    const head = lines[0].trim();
    const m = head.match(/^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC)\s+—\s+(.*)$/);
    if (!m) continue;
    const ts = m[1];
    const contact = m[2].trim();

    const fields = {};
    const sections = {};
    let currentSection = null;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === '---') break;

      const bullet = line.match(/^-\s+\*\*(.+?):\*\*\s*(.*)$/);
      if (bullet) {
        const key = bullet[1].trim();
        const val = bullet[2].replace(/`/g, '').trim();
        fields[key] = val;
        continue;
      }

      const sec = line.match(/^\*\*(.+?):\*\*\s*$/);
      if (sec) {
        currentSection = sec[1].trim();
        sections[currentSection] = '';
        continue;
      }

      if (currentSection) {
        sections[currentSection] += line + '\n';
      }
    }

    for (const k of Object.keys(sections)) sections[k] = sections[k].trim();

    leads.push({ id: ts, ts, contact, fields, sections });
  }

  return leads;
}
