// Vercel serverless function: приймає форму з /intensive і шле в Telegram
// Env vars: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

function escapeHTML(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.error('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID');
    return res.status(500).json({ error: 'Server not configured' });
  }

  const lines = [
    '🎯 <b>Нова заявка на інтенсив</b>',
    '',
    `<b>Імʼя:</b> ${escapeHTML(name)}`,
    `<b>Email:</b> ${escapeHTML(email)}`,
  ];
  if (telegram) lines.push(`<b>Telegram:</b> ${escapeHTML(telegram)}`);
  lines.push(`<b>Роль:</b> ${escapeHTML(role)}`);
  lines.push(`<b>Рівень:</b> ${escapeHTML(level)}`);
  lines.push('');
  lines.push(`<b>Мета:</b> ${escapeHTML(goal)}`);
  if (block) {
    lines.push('');
    lines.push(`<b>Блокери:</b> ${escapeHTML(block)}`);
  }

  const text = lines.join('\n');

  try {
    const tgRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });

    if (!tgRes.ok) {
      const errBody = await tgRes.text();
      console.error('Telegram delivery failed:', tgRes.status, errBody);
      return res.status(502).json({ error: 'Delivery failed' });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Submit handler error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
