/**
 * Dither ordenado, contra una matriz de Bayer 4x4. En vez de mezclar colores,
 * decide por píxel cuál de los pocos disponibles le toca, y la densidad de cada
 * uno da la sensación de los que no están.
 *
 * Se usa para dos cosas. Los iconos de proyecto lo aplican a un campo de ruido
 * en movimiento, y ahí el dither es todo el dibujo. Las pegatinas se lo comen
 * sobre su propio logo, y ahí es un acabado: el logo se rasteriza pequeño y se
 * trama, que es como se imprimían los sprites cuando no había colores.
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


/* ------------------------------------------------------------------ */
/* Las pegatinas                                                       */
/* ------------------------------------------------------------------ */

/**
 * Píxeles físicos por celda de trama, no CSS, igual que el grano de la onda.
 * Medido en CSS, una celda ocupa dos puntos físicos en un portátil y seis en un
 * móvil con DPR 3, y el mismo número sale fino en un sitio y basto en otro. En
 * físicos el grano se ve del mismo tamaño en todas partes, y este es el de los
 * iconos de proyecto: un punto CSS en una pantalla del montón.
 */
const GRANO = 2;
/** Pasos por canal. Tres son cuatro tonos por canal, que es poco a propósito:
 *  con muchos no hay nada que tramar y el dither no se ve. */
const NIVELES = 3;

/**
 * El logo, rasterizado pequeño y tramado.
 *
 * Se rasteriza pidiéndole al SVG que se pinte ya del tamaño de la rejilla, en
 * vez de pintarlo grande y encogerlo: así lo dibuja el motor de vectores con
 * sus curvas, y no un reescalado borroso al que luego habría que tramar el
 * propio desenfoque.
 *
 * El alfa no se trama, se corta en seco. De ella sale el troquelado, y una
 * silueta medio transparente por los bordes le daría un contorno deshilachado.
 * Cortada, el borde queda escalonado y el contorno blanco sigue el escalón, que
 * es justo lo que hace una pegatina de sprite.
 */
function pintar(canvas: HTMLCanvasElement, img: HTMLImageElement, celdas: number): boolean {
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) return false;

	ctx.drawImage(img, 0, 0, celdas, celdas);

	let datos: ImageData;
	try {
		datos = ctx.getImageData(0, 0, celdas, celdas);
	} catch {
		// Lienzo contaminado: hay navegadores que tratan un SVG dibujado como de
		// otro origen. Sin píxeles no hay trama, y el logo se queda como estaba.
		return false;
	}

	const p = datos.data;
	for (let y = 0; y < celdas; y++) {
		for (let x = 0; x < celdas; x++) {
			const i = (y * celdas + x) * 4;
			if (p[i + 3]! < 128) {
				p[i + 3] = 0;
				continue;
			}
			p[i + 3] = 255;
			const umbral = BAYER[y & 3]![x & 3]!;
			for (let c = 0; c < 3; c++) {
				const v = p[i + c]! / 255;
				// El umbral decide a qué lado del escalón cae este píxel. Dos
				// vecinos con el mismo color y distinto umbral caen a tonos
				// distintos, y de esa alternancia sale el color que falta.
				const q = Math.floor(v * NIVELES + umbral) / NIVELES;
				p[i + c] = Math.round(Math.min(1, Math.max(0, q)) * 255);
			}
		}
	}
	ctx.putImageData(datos, 0, 0);
	return true;
}

/**
 * El SVG original de cada pegatina. Hay que guardarlo porque el primer tramado
 * lo saca del documento, y al cambiar de tamaño la pegatina hay que volver a
 * rasterizarlo: el lienzo tiene la resolución del tamaño de antes, y estirarlo
 * a otro con las celdas a pares deja unas de un píxel y otras de dos.
 */
const fuentes = new WeakMap<HTMLElement, SVGElement>();

/** Se rinde con esta pegatina, y avisa para que la hoja de estilos la descubra
 *  igualmente en vez de dejarla invisible. */
function sinTrama(envoltorio: HTMLElement): void {
	envoltorio.dataset.stickerPlain = '';
}

function tramar(envoltorio: HTMLElement): void {
	const fuente = fuentes.get(envoltorio);
	const lado = envoltorio.offsetWidth;
	if (!fuente || !lado) return;

	// Se limita el DPR igual que en la onda: por encima de 3 el grano ya no se
	// distingue y solo cuesta lienzo.
	const dpr = Math.min(window.devicePixelRatio || 1, 3);
	const celdas = Math.max(8, Math.round((lado * dpr) / GRANO));
	// Ya está tramada a esta resolución. El observador salta por cualquier cambio
	// de caja, y el tamaño en píxeles no cambia en la mayoría.
	if (envoltorio.dataset.ditherCeldas === String(celdas)) return;
	envoltorio.dataset.ditherCeldas = String(celdas);

	// El tamaño va en el propio SVG, que es lo que le da al navegador la
	// resolución a la que rasterizarlo. La clase de utilidad sobra y estorba:
	// fuera del documento no hay hoja de estilos que la resuelva.
	const copia = fuente.cloneNode(true) as SVGElement;
	copia.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
	copia.setAttribute('width', String(celdas));
	copia.setAttribute('height', String(celdas));
	copia.removeAttribute('class');

	const img = new Image();
	img.addEventListener('load', () => {
		// Mientras cargaba pudo cambiar otra vez de tamaño, y esta ya es la vieja.
		if (envoltorio.dataset.ditherCeldas !== String(celdas)) return;

		const canvas = document.createElement('canvas');
		canvas.width = celdas;
		canvas.height = celdas;
		if (!pintar(canvas, img, celdas)) {
			sinTrama(envoltorio);
			return;
		}

		canvas.style.display = 'block';
		canvas.style.width = '100%';
		canvas.style.height = '100%';
		// Sin esto el navegador interpola al ampliar y devuelve el degradado
		// que acabamos de quitar.
		canvas.style.imageRendering = 'pixelated';
		envoltorio.firstElementChild?.replaceWith(canvas);
	});
	img.addEventListener('error', () => sinTrama(envoltorio));
	img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
		new XMLSerializer().serializeToString(copia),
	)}`;
}

export function bindStickerDither(root: ParentNode = document): void {
	for (const envoltorio of root.querySelectorAll<HTMLElement>('[data-sticker]')) {
		if (fuentes.has(envoltorio)) continue;
		const svg = envoltorio.querySelector('svg');
		if (!svg) {
			sinTrama(envoltorio);
			continue;
		}
		fuentes.set(envoltorio, svg.cloneNode(true) as SVGElement);

		// El primer tramado lo dispara el propio observador, que salta al empezar a
		// observar. Y a partir de ahí, cada vez que la pegatina cambie de tamaño:
		// así el tramado sigue a la escala sin que nadie tenga que avisarle.
		new ResizeObserver(() => tramar(envoltorio)).observe(envoltorio);
	}
}
