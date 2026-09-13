/**
 * Onda de gota por simulación, en los elementos marcados con data-ripple.
 *
 * No dibuja círculos que crecen. Mantiene un campo de alturas y resuelve sobre
 * él la ecuación de ondas discretizada: la altura siguiente de cada celda sale
 * de la media de sus vecinas menos su propio valor anterior, todo multiplicado
 * por un amortiguamiento. Es la diferencia finita de toda la vida.
 *
 * Importa porque un anillo dibujado no tiene física: dos ondas se pintan una
 * encima de otra y ya. Aquí se suman, interfieren, rebotan y se apagan solas,
 * que es lo que hace que se lea como agua y no como geometría.
 *
 * El campo se umbraliza contra la misma matriz de Bayer que los iconos de
 * proyecto, así que comparten grano.
 */

import { fbm } from './noise';
import { sound } from './sound';

const BAYER = [
	[0, 8, 2, 10],
	[12, 4, 14, 6],
	[3, 11, 1, 9],
	[15, 7, 13, 5],
].map((row) => row.map((v) => (v + 0.5) / 16));

const COLOR = '#a3a3a3';
/**
 * Lado de celda de dibujo, en píxeles de DISPOSITIVO y no CSS.
 *
 * Fijarlo en píxeles CSS hacía que el grano creciera con la densidad de
 * pantalla: en un móvil con DPR 3, una celda de 1 px CSS ocupa 3 físicos y el
 * efecto se ve mucho más basto que en un portátil. Midiéndolo en píxeles
 * reales el grano ocupa lo mismo en todas partes.
 */
const GRAIN = 2;
/** Píxeles de dibujo por celda de simulación. La física no necesita ir tan
 *  fina como el dibujo, y bajarla es lo que mantiene el coste a raya. */
const SIM = 3;
/** Cuánto se apaga la onda en cada paso. */
const DAMPING = 0.984;
/**
 * Pasos de simulación por fotograma.
 *
 * El frente avanza exactamente una celda por paso, así que esto es la velocidad
 * de propagación: con dos, la onda llega al mismo sitio en la mitad de tiempo.
 * En pantalla estrecha va a dos porque el recorrido es corto y a un paso por
 * fotograma se ve avanzar con demasiada calma.
 */
const STEPS_ANCHO = 1;
const STEPS_ESTRECHO = 2;
let steps = STEPS_ANCHO;
/** Radio de la salpicadura inicial, en celdas de simulación. */
const SPLASH = 3;
const AMPLITUDE = 52;
/**
 * Altura que corresponde a densidad máxima del dither. Si se queda corta, el
 * campo entero supera el umbral y en vez de crestas sale un disco macizo.
 */
const SCALE = 15;

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let cols = 0;
let rows = 0;
/** Píxeles CSS por celda. Sale del DPR, no es constante entre dispositivos. */
let scale = 1;
let sw = 0;
let sh = 0;
let cur: Float32Array = new Float32Array(0);
let prev: Float32Array = new Float32Array(0);
let raf = 0;
let quiet = 0;

function resize(): void {
	if (!canvas) return;
	steps = window.matchMedia('(max-width: 640px)').matches ? STEPS_ESTRECHO : STEPS_ANCHO;
	// Se limita el DPR: por encima de 3 el grano es invisible y solo cuesta.
	const dpr = Math.min(window.devicePixelRatio || 1, 3);
	scale = GRAIN / dpr;
	cols = Math.ceil(window.innerWidth / scale);
	rows = Math.ceil(window.innerHeight / scale);
	canvas.width = cols;
	canvas.height = rows;
	sw = Math.ceil(cols / SIM) + 2;
	sh = Math.ceil(rows / SIM) + 2;
	cur = new Float32Array(sw * sh);
	prev = new Float32Array(sw * sh);
}

/** Un paso de la ecuación de ondas. Devuelve la energía que queda. */
function step(): number {
	let energy = 0;
	for (let y = 1; y < sh - 1; y++) {
		const row = y * sw;
		for (let x = 1; x < sw - 1; x++) {
			const i = row + x;
			const next =
				((cur[i - 1]! + cur[i + 1]! + cur[i - sw]! + cur[i + sw]!) / 2 - prev[i]!) * DAMPING;
			prev[i] = next;
			energy += next < 0 ? -next : next;
		}
	}
	const swap = cur;
	cur = prev;
	prev = swap;
	return energy;
}

function render(t: number): void {
	if (!ctx) return;
	ctx.clearRect(0, 0, cols, rows);
	ctx.fillStyle = COLOR;

	// Se recorre la rejilla de simulación y solo se dibujan los bloques con
	// altura apreciable: en reposo casi todo el campo está a cero.
	for (let sy = 1; sy < sh - 1; sy++) {
		for (let sx = 1; sx < sw - 1; sx++) {
			const h = cur[sy * sw + sx]!;
			const mag = (h < 0 ? -h : h) / SCALE;
			if (mag < 0.06) continue;

			// Interpolamos hacia las vecinas para que el bloque de simulación no
			// se vea como un cuadrado de densidad uniforme.
			const hx = (cur[sy * sw + sx + 1]! - h) / SCALE;
			const hy = (cur[(sy + 1) * sw + sx]! - h) / SCALE;

			// El grano lo pone el mismo ruido que los iconos de proyecto. La física
			// da los frentes, pero un frente liso se lee como un aro dibujado; al
			// modular la densidad con ruido la onda se deshace en textura y deja
			// de parecer geometría.
			const grain = 0.28 + 1.5 * fbm((sx - 1) * 0.42, (sy - 1) * 0.42, t * 1.1);

			const px = (sx - 1) * SIM;
			const py = (sy - 1) * SIM;
			for (let dy = 0; dy < SIM; dy++) {
				const y = py + dy;
				if (y < 0 || y >= rows) continue;
				const fy = dy / SIM;
				for (let dx = 0; dx < SIM; dx++) {
					const x = px + dx;
					if (x < 0 || x >= cols) continue;
					const v = h / SCALE + hx * (dx / SIM) + hy * fy;
					const a = (v < 0 ? -v : v) * grain;
					if (a > BAYER[y & 3]![x & 3]!) ctx.fillRect(x, y, 1, 1);
				}
			}
		}
	}
}

function frame(now: number): void {
	let energy = 0;
	for (let i = 0; i < steps; i++) energy = step();
	render(now / 1000);

	// Dos segundos por debajo del umbral y paramos el bucle.
	quiet = energy < 4 ? quiet + 1 : 0;
	if (quiet > 20) {
		raf = 0;
		if (ctx) ctx.clearRect(0, 0, cols, rows);
		return;
	}
	raf = requestAnimationFrame(frame);
}

function splash(clientX: number, clientY: number): void {
	const cx = Math.round(clientX / scale / SIM) + 1;
	const cy = Math.round(clientY / scale / SIM) + 1;

	for (let dy = -SPLASH; dy <= SPLASH; dy++) {
		for (let dx = -SPLASH; dx <= SPLASH; dx++) {
			const d = Math.sqrt(dx * dx + dy * dy);
			if (d > SPLASH) continue;
			const x = cx + dx;
			const y = cy + dy;
			if (x < 1 || y < 1 || x >= sw - 1 || y >= sh - 1) continue;
			// Amplitud irregular: una gota real no golpea como un punto perfecto,
			// y si la salpicadura es simétrica lo que sale son aros perfectos.
			const jitter = 0.3 + Math.random() * 1.5;
			cur[y * sw + x] = -AMPLITUDE * (1 - d / SPLASH) * jitter;
		}
	}

	if (!raf) {
		quiet = 0;
		raf = requestAnimationFrame(frame);
	}
}

/**
 * Se delega en window en vez de enganchar cada elemento: así vale también para
 * lo que aparezca después, sin tener que volver a recorrer el DOM.
 *
 * data-ripple="unmute" solo dispara al activar el sonido, no al silenciarlo. La
 * condición se lee en el markup en vez de estar escondida aquí dentro. Como
 * pointerdown va antes que el click, en ese momento el estado todavía es el
 * anterior: si ahora no está silenciado, este clic lo va a silenciar.
 */
function armed(e: Event): boolean {
	const target = e.target;
	if (!(target instanceof Element)) return false;

	const trigger = target.closest<HTMLElement>('[data-ripple]');
	if (!trigger) return false;
	if (trigger.dataset.ripple === 'unmute' && !sound.isMuted()) return false;
	return true;
}

export function bindRipple(): void {
	if (typeof window === 'undefined' || canvas) return;
	if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
		// Sin onda, pero el sonido sigue: es respuesta a una acción, no adorno.
		window.addEventListener('pointerdown', (e) => {
			if (armed(e)) sound.drop();
		});
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
		'opacity:1',
	].join(';');
	document.body.appendChild(canvas);

	ctx = canvas.getContext('2d');
	if (!ctx) return;
	resize();
	window.addEventListener('resize', resize);

	// La guarda contra la selección va en mousedown y no aquí: en un
	// PointerEvent, detail vale 0 y no cuenta los clics, y preventDefault sobre
	// pointerdown tampoco frena la selección del mousedown que viene detrás.
	window.addEventListener('mousedown', (e) => {
		if (e.detail > 1 && armed(e)) e.preventDefault();
	});

	window.addEventListener('pointerdown', (e) => {
		if (!armed(e)) return;
		sound.drop();
		splash(e.clientX, e.clientY);
	});
}
