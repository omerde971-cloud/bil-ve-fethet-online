const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function send(res, statusCode, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function resolvePublicPath(urlPath) {
  const safePath = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  const requestedPath = safePath === '/' ? '/index.html' : safePath;
  const filePath = path.join(PUBLIC_DIR, requestedPath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    return null;
  }

  return filePath;
}

const server = http.createServer((req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) {
    send(res, 405, 'Method Not Allowed');
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const filePath = resolvePublicPath(url.pathname);

  if (!filePath) {
    send(res, 403, 'Forbidden');
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      send(res, err.code === 'ENOENT' ? 404 : 500, err.code === 'ENOENT' ? 'Not Found' : 'Server Error');
      return;
    }

    const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store'
    });
    res.end(req.method === 'HEAD' ? undefined : content);
  });
});

server.listen(PORT, () => {
  console.log(`BilFet server running at http://localhost:${PORT}`);
});
