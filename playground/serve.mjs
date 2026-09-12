// Server estático mínimo para el sound lab. Aparte del dev server de Astro
// para que nada de playground/ acabe en el build del portfolio.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

createServer(async (req, res) => {
	const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
	const safe = normalize(path === '/' ? '/sound-lab.html' : path).replace(/^(\.\.[/\\])+/, '');
	try {
		const body = await readFile(join(root, safe));
		res.writeHead(200, { 'content-type': TYPES[extname(safe)] ?? 'application/octet-stream' });
		res.end(body);
	} catch {
		res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
	}
}).listen(4322, () => console.log('sound-lab → http://localhost:4322'));
