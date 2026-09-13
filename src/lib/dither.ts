/**
 * Dither animado para los iconos de proyecto.
 *
 * Un campo de ondas superpuestas (el "agua") se umbraliza contra una matriz de
 * Bayer 4x4. Eso es el dither ordenado de toda la vida: en vez de mezclar
 * colores, decide por píxel si pinta o no, y la densidad de los que pinta da la
 * sensación de degradado.
 */

// Bayer 4x4 normalizada a (0,1). El orden de los valores es lo que evita que
// los píxeles encendidos formen bandas en vez de repartirse.
import { fbm } from './noise';

const BAYER = [
	[0, 8, 2, 10],
	[12, 4, 14, 6],
	[3, 11, 1, 9],
	[15, 7, 13, 5],
].map((row) => row.map((v) => (v + 0.5) / 16));

interface Cell {
	ctx: CanvasRenderingContext2D;
	color: string;
	seed: number;
	w: number;
	h: number;
	visible: boolean;
}

const cells: Cell[] = [];
let raf = 0;
let last = 0;

function draw(cell: Cell, t: number): void {
	const { ctx, w, h } = cell;
	// El seed desplaza a cada icono a otra región del ruido, así que no solo
	// van desfasados: es directamente otro patrón.
	const drift = t * 7 + cell.seed * 53;
	const evolve = t * 1.6 + cell.seed * 17;

	ctx.clearRect(0, 0, w, h);
	ctx.fillStyle = cell.color;

	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			// El campo lo da ruido, no senos. Una suma de senos es periódica por
			// construcción: por muy incomensurables que sean las frecuencias,
			// acaban viéndose las mismas bandas cruzando en la misma dirección
			// una y otra vez. El ruido no repite.
			const n = fbm((x + drift) * 0.13, (y + drift * 0.3) * 0.13, evolve);

			// Rampa diagonal: denso arriba a la izquierda, disuelto abajo a la derecha.
			// Pesa menos que el ruido para que cada masa que pasa encienda o apague
			// zonas enteras, en vez de dejar parpadeando píxeles sueltos.
			const ramp = 1 - (x + y) / (w + h - 2);
			const v = ramp * 0.45 + (n - 0.5) * 3.2 + 0.24;

			if (v > BAYER[y & 3]![x & 3]!) ctx.fillRect(x, y, 1, 1);
		}
	}
}

function frame(now: number): void {
	raf = requestAnimationFrame(frame);
	// 30 fps. A 15 el movimiento se veía a tirones y parecía que iba lento.
	// Son 3 canvas de 144 píxeles: el coste es despreciable.
	if (now - last < 33) return;
	last = now;
	const t = now / 1000;
	for (const cell of cells) {
		if (cell.visible) draw(cell, t);
	}
}

/**
 * El texto de los (more) se pinta mezclado con gris, no con el color puro.
 * Para que el dither combine con ellos aplicamos la misma mezcla aquí, en vez
 * de dejar tres hexes ya mezclados sueltos en el markup: así el color de cada
 * proyecto se declara una sola vez y la relación queda en el código.
 *
 * color-mix() en fillStyle es reciente, de modo que si el navegador no la
 * entiende se cae al color puro y como mucho se ve algo más vivo.
 */
function mutedColor(raw: string): string {
	const ctx = document.createElement('canvas').getContext('2d');
	if (!ctx) return raw;

	const gray =
		getComputedStyle(document.documentElement).getPropertyValue('--color-neutral-400').trim() ||
		'#a3a3a3';

	const SENTINEL = '#000000';
	ctx.fillStyle = SENTINEL;
	ctx.fillStyle = `color-mix(in oklab, ${raw} 70%, ${gray})`;
	return ctx.fillStyle === SENTINEL ? raw : (ctx.fillStyle as string);
}

export function bindDither(root: ParentNode = document): void {
	const canvases = root.querySelectorAll<HTMLCanvasElement>('canvas[data-dither]');
	if (!canvases.length) return;

	const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	// Si el icono no se ve, no lo dibujamos.
	const observer = new IntersectionObserver((entries) => {
		for (const entry of entries) {
			const cell = (entry.target as HTMLCanvasElement & { _cell?: Cell })._cell;
			if (cell) cell.visible = entry.isIntersecting;
		}
	});

	for (const canvas of canvases) {
		if (canvas.dataset.ditherBound !== undefined) continue;
		canvas.dataset.ditherBound = '';

		const ctx = canvas.getContext('2d');
		if (!ctx) continue;

		const cell: Cell = {
			ctx,
			color: mutedColor(canvas.dataset.color ?? '#888'),
			seed: Number(canvas.dataset.seed ?? 0),
			w: canvas.width,
			h: canvas.height,
			visible: true,
		};

		if (still) {
			// Sin movimiento: un único fotograma y fuera.
			draw(cell, 0);
			continue;
		}

		(canvas as HTMLCanvasElement & { _cell?: Cell })._cell = cell;
		cells.push(cell);
		observer.observe(canvas);
	}

	if (cells.length && !raf) raf = requestAnimationFrame(frame);
}
