// Local-only WebDAV fixture for the ignored digest verification integration test.
const http = require('node:http');
const crypto = require('node:crypto');

const contents = Buffer.alloc(1024 * 1024 + 7, 0x61);
const digest = crypto.createHash('sha256').update(contents).digest('base64');
const wrongDigest = Buffer.alloc(32).toString('base64');
const counts = { good: 0, bad: 0, corrupt: 0, mismatch: 0 };
const files = new Map();
const directories = new Set(['/']);
const etagFor = (data) => `"${crypto.createHash('sha256').update(data).digest('hex')}"`;
const digestFor = (data) => crypto.createHash('sha256').update(data).digest('base64');
const parentOf = (path) => path.slice(0, path.lastIndexOf('/')) || '/';
const xmlEntry = (path, isDirectory, data) => {
  const etag = isDirectory ? '' : `<d:getetag>${etagFor(data)}</d:getetag>`;
  return `<d:response><d:href>${path}</d:href><d:propstat><d:prop><d:resourcetype>${isDirectory ? '<d:collection/>' : ''}</d:resourcetype><d:getcontentlength>${isDirectory ? 0 : data.length}</d:getcontentlength>${etag}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
};
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const path = new URL(req.url, 'http://127.0.0.1').pathname;
    if (req.method === 'GET' && path === '/_counts') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(counts));
    }
    if (req.method === 'GET' && path === '/chunked') {
      res.writeHead(200);
      res.write(contents.subarray(0, 2048));
      return res.end(contents.subarray(2048));
    }
    const name = path.slice(1);
    if (['good', 'bad', 'corrupt', 'mismatch'].includes(name)) {
      const etag = '"version-1"';
      if (req.method === 'HEAD') {
        res.writeHead(200, {
          ETag: etag,
          'Content-Length': contents.length,
          'Repr-Digest': `sha-256=:${name === 'bad' || name === 'corrupt' ? wrongDigest : digest}:`,
        });
        return res.end();
      }
      if (req.method === 'PROPFIND') {
        const body = `<d:multistatus xmlns:d="DAV:"><d:response><d:href>${path}</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>${contents.length}</d:getcontentlength><d:getetag>${name === 'mismatch' ? '"version-2"' : etag}</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`;
        res.writeHead(207, { 'Content-Type': 'application/xml', 'Content-Length': Buffer.byteLength(body) });
        return res.end(body);
      }
      if (req.method === 'GET') {
        counts[name]++;
        res.writeHead(200, { ETag: etag, 'Content-Length': contents.length });
        return res.end(name === 'corrupt' ? Buffer.alloc(contents.length, 0x62) : contents);
      }
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(200, { Allow: 'OPTIONS, PROPFIND, MKCOL, GET, HEAD, PUT, DELETE, MOVE' });
      return res.end();
    }
    if (req.method === 'MKCOL') {
      if (directories.has(path) || files.has(path)) res.writeHead(405);
      else if (!directories.has(parentOf(path))) res.writeHead(409);
      else { directories.add(path); res.writeHead(201); }
      return res.end();
    }
    if (req.method === 'PROPFIND') {
      if (!directories.has(path) && !files.has(path)) { res.writeHead(404); return res.end(); }
      const entries = [xmlEntry(path, directories.has(path), files.get(path))];
      if (req.headers.depth === '1' && directories.has(path)) {
        for (const directory of directories) if (directory !== path && parentOf(directory) === path) entries.push(xmlEntry(directory, true));
        for (const [file, data] of files) if (parentOf(file) === path) entries.push(xmlEntry(file, false, data));
      }
      const body = `<d:multistatus xmlns:d="DAV:">${entries.join('')}</d:multistatus>`;
      res.writeHead(207, { 'Content-Type': 'application/xml', 'Content-Length': Buffer.byteLength(body) });
      return res.end(body);
    }
    if (req.method === 'PUT') {
      const current = files.get(path);
      if (!directories.has(parentOf(path))) res.writeHead(409);
      else if (req.headers['if-none-match'] === '*' && current) res.writeHead(412);
      else if (req.headers['if-match'] && (!current || req.headers['if-match'] !== etagFor(current))) res.writeHead(412);
      else { files.set(path, Buffer.concat(chunks)); res.writeHead(201); }
      return res.end();
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      const data = files.get(path);
      if (!data) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { ETag: etagFor(data), 'Content-Length': data.length,
        'Repr-Digest': `sha-256=:${digestFor(data)}:` });
      return res.end(req.method === 'GET' ? data : undefined);
    }
    if (req.method === 'MOVE') {
      const data = files.get(path);
      const dest = new URL(req.headers.destination).pathname;
      if (!data) res.writeHead(404);
      else if (req.headers['if-match'] && req.headers['if-match'] !== etagFor(data)) res.writeHead(412);
      else if (req.headers.overwrite === 'F' && files.has(dest)) res.writeHead(412);
      else { files.set(dest, data); files.delete(path); res.writeHead(201); }
      return res.end();
    }
    if (req.method === 'DELETE') {
      const data = files.get(path);
      if (data && req.headers['if-match'] && req.headers['if-match'] !== etagFor(data)) res.writeHead(412);
      else if (data) { files.delete(path); res.writeHead(204); }
      else if (directories.has(path)) {
        for (const file of files.keys()) if (file.startsWith(`${path}/`)) files.delete(file);
        directories.delete(path); res.writeHead(204);
      } else res.writeHead(404);
      return res.end();
    }
    res.writeHead(405);
    res.end();
  });
});
server.listen(0, '127.0.0.1', () => process.stdout.write(`${server.address().port}\n`));
