// Обгортка для власного хостингу (Docker на Hetzner): емулює рантайм Vercel Node
// для функцій у цій теці, щоб їхню логіку не довелося переписувати.
//
//   /api/<name>  →  api/<name>.js (default export: async (req, res) => ...)
//
// Як і на Vercel, файли з "_" на початку (спільні хелпери, _gist.js) назовні
// не видно; server.js — теж. Що тут замість платформи Vercel:
//   req.query  — параметри рядка запиту (повтори ключа → масив);
//   req.body   — розбирається ліниво за Content-Type, як у @vercel/node:
//                application/json → об'єкт (порожнє тіло → {}, битий JSON → 400),
//                x-www-form-urlencoded → об'єкт, text/plain → рядок,
//                application/octet-stream → Buffer, решта → undefined;
//   res.status() / res.json() / res.send() / res.redirect(); setHeader — штатний Node.
// req.cookies не емулюється — жодна функція його не читає.
//
// "type": "module" лежить в api/package.json: функції написані як ES-модулі
// (на Vercel їх транспілював білд, тут Node читає файли як є).
//
// Слухає лише 127.0.0.1 — ззовні запит приходить через Caddy (/api/*).
// Падіння процесу не гасить сайт: docker-start.sh перезапускає node у циклі.

import http from 'node:http';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import querystring from 'node:querystring';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const HOST = process.env.API_HOST || '127.0.0.1';
const PORT = Number(process.env.API_PORT || 3001);
const BODY_LIMIT = 4.5 * 1024 * 1024; // ліміт тіла запиту на Vercel

class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function pickHandler(mod) {
  let fn = mod.default;
  // CommonJS із транспільованим ESM: module.exports = { default: fn }
  if (fn && typeof fn !== 'function' && typeof fn.default === 'function') fn = fn.default;
  if (typeof fn !== 'function') throw new Error('немає default-експорту з функцією');
  return fn;
}

// Таблиця маршрутів будується з вмісту теки, а не з URL, тож запит на кшталт
// /api/../щось не дотягнеться до довільного файлу. Кожна функція вантажиться
// окремо: зламана одна не валить інші (на Vercel вони теж були ізольовані).
const routes = new Map();
for (const file of readdirSync(DIR)) {
  const m = file.match(/^([^_.][^.]*)\.(js|mjs|cjs)$/);
  if (!m || m[1] === 'server') continue;
  const loaded = import(pathToFileURL(path.join(DIR, file)).href)
    .then(pickHandler)
    .catch((e) => {
      console.error(`[api] ${file} не завантажився:`, e);
      return null;
    });
  routes.set(`/api/${m[1]}`, loaded);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        req.removeAllListeners('data');
        req.resume(); // дочитуємо в нікуди, щоб відповісти 413
        reject(new ApiError(413, 'Request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseBody(raw, contentType) {
  if (!contentType) return undefined;
  const type = contentType.split(';')[0].trim().toLowerCase();
  switch (type) {
    case 'application/json': {
      const str = raw.toString('utf8');
      if (!str) return {};
      try {
        return JSON.parse(str);
      } catch {
        throw new ApiError(400, 'Invalid JSON');
      }
    }
    case 'application/x-www-form-urlencoded':
      return querystring.parse(raw.toString('utf8'));
    case 'text/plain':
      return raw.toString('utf8');
    case 'application/octet-stream':
      return raw;
    default:
      return undefined;
  }
}

// Як setLazyProp у @vercel/node: розбір при першому зверненні, далі — кеш.
function setLazyBody(req, raw) {
  Object.defineProperty(req, 'body', {
    configurable: true,
    enumerable: true,
    get() {
      const value = parseBody(raw, req.headers['content-type']);
      Object.defineProperty(req, 'body', { value, writable: true, configurable: true, enumerable: true });
      return value;
    },
    set(value) {
      Object.defineProperty(req, 'body', { value, writable: true, configurable: true, enumerable: true });
    },
  });
}

function withCharset(type) {
  return /;\s*charset=/i.test(type) ? type : `${type}; charset=utf-8`;
}

function addVercelHelpers(req, res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };

  res.send = (body) => {
    let chunk = body;
    if (chunk === undefined || chunk === null) {
      chunk = '';
    } else if (Buffer.isBuffer(chunk)) {
      if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/octet-stream');
    } else if (typeof chunk === 'object' || typeof chunk === 'number' || typeof chunk === 'boolean') {
      return res.json(chunk);
    } else {
      chunk = String(chunk);
      const type = res.getHeader('Content-Type');
      res.setHeader('Content-Type', withCharset(typeof type === 'string' ? type : 'text/html'));
    }

    if (res.statusCode === 204 || res.statusCode === 304) {
      res.removeHeader('Content-Type');
      res.removeHeader('Content-Length');
      res.removeHeader('Transfer-Encoding');
      chunk = '';
    } else {
      res.setHeader('Content-Length', Buffer.byteLength(chunk));
    }

    if (req.method === 'HEAD') res.end();
    else res.end(chunk);
    return res;
  };

  res.json = (obj) => {
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.send(JSON.stringify(obj));
  };

  res.redirect = (statusOrUrl, url) => {
    let status = statusOrUrl;
    if (typeof statusOrUrl === 'string') {
      url = statusOrUrl;
      status = 307; // типовий код res.redirect на Vercel
    }
    if (typeof status !== 'number' || typeof url !== 'string') {
      throw new Error('res.redirect: очікується ([status,] url)');
    }
    res.writeHead(status, { Location: url }).end();
    return res;
  };
}

function sendError(res, code, message) {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ error: message }));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const loaded = routes.get(url.pathname);

  try {
    if (!loaded) throw new ApiError(404, 'Not found');
    const handler = await loaded;
    if (!handler) throw new Error(`функція ${url.pathname} не завантажилась`);

    req.query = querystring.parse(url.search.slice(1));
    setLazyBody(req, await readBody(req));
    addVercelHelpers(req, res);

    await handler(req, res);
  } catch (e) {
    if (e instanceof ApiError) {
      sendError(res, e.statusCode, e.message);
    } else {
      console.error(`[api] ${req.method} ${url.pathname}:`, e);
      sendError(res, 500, 'Internal Server Error');
    }
  }
});

// Забута проміс-помилка в одній функції не має валити весь процес.
process.on('unhandledRejection', (e) => console.error('[api] unhandledRejection:', e));

server.listen(PORT, HOST, () => {
  console.log(`[api] ${[...routes.keys()].join(', ')} → http://${HOST}:${PORT}`);
});
