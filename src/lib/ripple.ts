/**
 * Onda de gota al hacer clic en cualquier parte.
 *
 * Un canvas fijo sobre toda la página dibuja un anillo que se expande desde el
 * punto pulsado, umbralizado contra la misma matriz de Bayer que los iconos de
 * proyecto, de modo que la onda se deshace en píxeles conforme se aleja.
 */

import { sound } from './sound';

const BAYER = [
	[0, 8, 2, 10],
	[12, 4, 14, 6],
	[3, 11, 1, 9],
	[15, 7, 13, 5],
].map((row) => row.map((v) => (v + 0.5) / 16));

/**
 * Lado de celda en píxeles CSS. A 1 el grano coincide con el de los iconos de
 * proyecto, que son un canvas de 24x24 mostrado a 24px: una celda por píxel.
 */
const CELL = 1;
const COLOR = '#a3a3a3';
const DURATION = 600;
/** Hasta dónde llega la onda, en celdas (que aquí son píxeles CSS). */
const REACH = 105;
/** Frecuencia radial: separación entre crestas, en radianes por celda. */
const RINGS = 0.46;

interface Ripple {
	x: number;
	y: number;
	born: number;
	/** Amplitud de la deformación angular, distinta en cada gota. */
	wobA: number;
	wobB: number;
}

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let cols = 0;
let rows = 0;
let ripples: Ripple[] = [];
let raf = 0;

function resize(): void {
	if (!canvas) return;
	cols = Math.ceil(window.innerWidth / CELL);
	rows = Math.ceil(window.innerHeight / CELL);
	canvas.width = cols;
	canvas.height = rows;
}

function draw(now: number): void {
	if (!ctx) return;

	ripples = ripples.filter((r) => now - r.born < DURATION);
	ctx.clearRect(0, 0, cols, rows);
	// Se fija aquí y no una sola vez al crear el canvas: cambiar width o height
	// resetea el estado del contexto, y el fillStyle volvía a negro.
	ctx.fillStyle = COLOR;

	if (!ripples.length) {
		raf = 0;
		return;
	}
	raf = requestAnimationFrame(draw);

	for (const r of ripples) {
		const age = (now - r.born) / DURATION;
		// El frente del paquete de ondas, y su anchura, que crece al avanzar.
		const front = age * REACH;
		const spread = 13 + age * 30;
		const fade = (1 - age) ** 1.5;

		// Solo recorremos la banda del frente. Barrer la pantalla entera por
		// cada onda sería tirar el presupuesto en celdas que salen a cero.
		const outer = Math.ceil(front + spread * 1.6);
		const inner = Math.max(0, front - spread * 1.6);
		const y0 = Math.max(0, Math.floor(r.y - outer));
		const y1 = Math.min(rows - 1, Math.ceil(r.y + outer));

		for (let y = y0; y <= y1; y++) {
			const dy = y - r.y;
			const half = Math.sqrt(Math.max(0, outer * outer - dy * dy));
			const x0 = Math.max(0, Math.floor(r.x - half));
			const x1 = Math.min(cols - 1, Math.ceil(r.x + half));

			for (let x = x0; x <= x1; x++) {
				const dx = x - r.x;
				const d = Math.sqrt(dx * dx + dy * dy);
				if (d < inner || d < 1) continue;

				// Deformación angular: sin esto el frente es una circunferencia
				// exacta y se lee como una figura geométrica, no como agua. Se
				// calcula con el seno y el coseno ya implícitos en dx/d y dy/d,
				// para no pagar un atan2 por celda.
				const nx = dx / d;
				const ny = dy / d;
				const wob = nx * ny * r.wobA + (nx * nx - ny * ny) * r.wobB;
				const dd = d + wob;

				const off = (dd - front) / spread;
				const env = Math.exp(-off * off) * fade;
				// Varias crestas dentro del paquete, viajando hacia fuera algo
				// más despacio que él: es lo que hace que parezcan emerger.
				const wave = 0.5 + 0.5 * Math.sin(dd * RINGS - age * 26);

				if (env * wave > BAYER[y & 3]![x & 3]!) ctx.fillRect(x, y, 1, 1);
			}
		}
	}
}

export function bindRipple(): void {
	if (typeof window === 'undefined' || canvas) return;
	if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
		// Sin onda, pero el sonido sigue: es información, no decoración.
		window.addEventListener('pointerdown', () => sound.drop());
		return;
	}

	canvas = document.createElement('canvas');
	canvas.setAttribute('aria-hidden', 'true');
	canvas.style.cssText = [
		'position:fixed',
		'inset:0',
		'width:100%',
		'height:100%',
		'pointer-events:none',
		'z-index:-1',
		'image-rendering:pixelated',
		'opacity:0.85',
	].join(';');
	document.body.appendChild(canvas);

	ctx = canvas.getContext('2d');
	if (!ctx) return;

	resize();
	window.addEventListener('resize', resize);

	window.addEventListener('pointerdown', (e) => {
		sound.drop();
		ripples.push({
			x: e.clientX / CELL,
			y: e.clientY / CELL,
			born: performance.now(),
			wobA: (Math.random() - 0.5) * 14,
			wobB: (Math.random() - 0.5) * 10,
		});
		if (!raf) raf = requestAnimationFrame(draw);
	});
}
