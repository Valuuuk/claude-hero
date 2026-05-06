// Vercel serverless function: приймає форму з /intensive, шле в Telegram і дописує в приватний Gist (leads.md)
// Env vars:
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID — для пуш-сповіщень
//   GITHUB_TOKEN, GIST_ID                — для архіву заявок у Gist
//   GIST_FILENAME (optional, default 'leads.md')

function escapeHTML(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function sendTelegram({ token, chatId, text }) {
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
  if (!r.ok) {
    throw new Error(`Telegram ${r.status}: ${await r.text()}`);
  }
}

async function appendToGist({ token, gistId, filename, entry }) {
  // 1. читаємо поточний вміст
  const getR = await fetch(`https://api.github.com/gists/${gistId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'claude-hero-intensive',
    },
  });
  if (!getR.ok) throw new Error(`Gist GET ${getR.status}: ${await getR.text()}`);
  const gist = await getR.json();
  const file = gist.files?.[filename];
  const current = file?.content ?? `# Claude Intensive — Заявки\n\n---\n\n`;

  const newContent = current + entry;

  // 2. дописуємо
  const patchR = await fetch(`https://api.github.com/gists/${gistId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'claude-hero-intensive',
    },
    body: JSON.stringify({
      files: { [filename]: { content: newContent } },
    }),
  });
  if (!patchR.ok) throw new Error(`Gist PATCH ${patchR.status}: ${await patchR.text()}`);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body || {};
  const { name, email, telegram, role, level, goal, block } = body;

  if (!name || !email || !role || !level || !goal) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  // ---- Telegram (HTML) ----
  const tgLines = [
    '🎯 <b>Нова заявка на інтенсив</b>',
    `<i>${ts}</i>`,
    '',
    `<b>Імʼя:</b> ${escapeHTML(name)}`,
    `<b>Email:</b> ${escapeHTML(email)}`,
  ];
  if (telegram) tgLines.push(`<b>Telegram:</b> ${escapeHTML(telegram)}`);
  tgLines.push(`<b>Роль:</b> ${escapeHTML(role)}`);
  tgLines.push(`<b>Рівень:</b> ${escapeHTML(level)}`);
  tgLines.push('');
  tgLines.push(`<b>Мета:</b> ${escapeHTML(goal)}`);
  if (block) {
    tgLines.push('');
    tgLines.push(`<b>Блокери:</b> ${escapeHTML(block)}`);
  }
  const tgText = tgLines.join('\n');

  // ---- Markdown (для Gist) ----
  const mdLines = [
    `## ${ts} — ${name}`,
    '',
    `- **Email:** ${email}`,
  ];
  if (telegram) mdLines.push(`- **Telegram:** ${telegram}`);
  mdLines.push(`- **Роль:** ${role}`);
  mdLines.push(`- **Рівень:** ${level}`);
  mdLines.push('');
  mdLines.push(`**Мета:**`);
  mdLines.push('');
  mdLines.push(goal);
  if (block) {
    mdLines.push('');
    mdLines.push('**Блокери:**');
    mdLines.push('');
    mdLines.push(block);
  }
  mdLines.push('');
  mdLines.push('---');
  mdLines.push('');
  const mdEntry = mdLines.join('\n');

  // ---- Виконуємо обидві дії паралельно, не валимось якщо одна впала ----
  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  const tgChat = process.env.TELEGRAM_CHAT_ID;
  const ghToken = process.env.GITHUB_TOKEN;
  const gistId = process.env.GIST_ID;
  const gistFile = process.env.GIST_FILENAME || 'leads.md';

  const tasks = [];
  if (tgToken && tgChat) {
    tasks.push(
      sendTelegram({ token: tgToken, chatId: tgChat, text: tgText })
        .then(() => ({ tg: 'ok' }))
        .catch((e) => { console.error('TG fail:', e.message); return { tg: 'fail' }; })
    );
  }
  if (ghToken && gistId) {
    tasks.push(
      appendToGist({ token: ghToken, gistId, filename: gistFile, entry: mdEntry })
        .then(() => ({ gist: 'ok' }))
        .catch((e) => { console.error('Gist fail:', e.message); return { gist: 'fail' }; })
    );
  }

  if (tasks.length === 0) {
    console.error('No delivery channels configured');
    return res.status(500).json({ error: 'Server not configured' });
  }

  const results = await Promise.all(tasks);
  const merged = Object.assign({}, ...results);

  // Якщо обидва канали впали — повертаємо помилку. Якщо хоч один ок — користувачу ОК.
  const anyOk = Object.values(merged).some((v) => v === 'ok');
  if (!anyOk) {
    return res.status(502).json({ error: 'Delivery failed' });
  }

  return res.status(200).json({ ok: true, channels: merged });
}
