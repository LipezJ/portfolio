/**
 * Sonidos de interfaz sintetizados con Web Audio. No carga ningún archivo.
 *
 * La paleta y el registro salen de playground/sound-lab.html. Las notas
 * (D3-G4, solo cuartas y quintas justas) vienen del análisis del menú de
 * sistema de Wii en beyondthebeep.tumblr.com/post/41170831979.
 */

export interface Palette {
	carrier: OscillatorType;
	fmRatio: number;
	fmDepth: number;
	edgeWave: OscillatorType;
	edgeRatio: number;
	edgeLevel: number;
	attack: number;
	decayMul: number;
	minDecay: number;
	scoop: number;
	cutoff: number;
	filterEnd: number;
	filterDecay: number;
	transpose: number;
	level: number;
}

export interface Voice {
	freq: number;
	freqEnd?: number;
	duration?: number;
	gain?: number;
	offset?: number;
}

/** Paleta "Madera": percusiva y seca, con el filtro cerrándose sobre el ataque. */
export const MADERA: Palette = {
	carrier: 'sine',
	fmRatio: 2.5,
	fmDepth: 1.2,
	edgeWave: 'triangle',
	edgeRatio: 6,
	edgeLevel: 0.22,
	attack: 0.002,
	decayMul: 0.9,
	minDecay: 0.09,
	scoop: 0.04,
	cutoff: 5000,
	filterEnd: 0.18,
	filterDecay: 0.35,
	transpose: 0,
	level: 0.5,
};

const D3 = 146.83, G3 = 196.0, A3 = 220.0, D4 = 293.66, G4 = 392.0, A4 = 440.0, D5 = 587.33;

/** Notas para recorrer listas, en orden ascendente. */
export const STEPS = [D3, G3, A3, D4, G4, A4, D5];

export const CUES = {
	/** Volver atrás. D3, del análisis. */
	back: [{ freq: D3, duration: 0.07 }],
	/** Confirmar. G4, del análisis; cuarta justa sobre el D3. */
	select: [{ freq: G4, duration: 0.12 }],
	/** Tick de hover. Muy corto y a bajo volumen. */
	hover: [{ freq: A4, duration: 0.04, gain: 0.4 }],
	/** Abrir un enlace o navegar. */
	nav: [{ freq: D4, duration: 0.06 }, { freq: G4, duration: 0.1, offset: 0.05 }],
	open: [{ freq: D4, duration: 0.06 }, { freq: A4, duration: 0.09, offset: 0.05 }],
	close: [{ freq: G4, duration: 0.06 }, { freq: D3, duration: 0.1, offset: 0.05 }],
	reveal: [
		{ freq: D4, duration: 0.06 },
		{ freq: G4, duration: 0.06, offset: 0.06 },
		{ freq: D5, duration: 0.09, offset: 0.12 },
	],
	/** Tres clicks percusivos, como el scroll de página del menú de Wii. */
	scroll: [0, 1, 2].map((i) => ({ freq: D4, duration: 0.035, gain: 0.75 - i * 0.13, offset: i * 0.045 })),
	/** Suena al desmutear, para confirmar que el audio funciona. */
	toggleOn: [D3, G3, D4, G4].map((freq, i) => ({ freq, duration: 0.09, offset: i * 0.06 })),
} satisfies Record<string, Voice[]>;

export type Cue = keyof typeof CUES;

const MUTED_KEY = 'portfolio:sound-muted';
const CHANGE_EVENT = 'portfolio:sound-change';

class Sound {
	palette: Palette = MADERA;
	volume = 0.16;

	#ctx: AudioContext | null = null;
	#master: GainNode | null = null;
	#pointer: MediaQueryList | null = null;

	constructor() {
		if (typeof window === 'undefined') return;

		this.#pointer = window.matchMedia('(hover: hover) and (pointer: fine)');

		// Un AudioContext solo puede nacer de un gesto del usuario, así que lo
		// creamos en el primero que llegue y lo dejamos listo.
		const wake = () => this.#context();
		for (const type of ['pointerdown', 'keydown', 'touchstart'] as const) {
			window.addEventListener(type, wake, { once: true, passive: true });
		}

		// Si el usuario mutea en otra pestaña, esta se entera.
		window.addEventListener('storage', (e) => {
			if (e.key === MUTED_KEY) this.#emit();
		});
	}

	/** Arranca muteado: nadie quiere que una web suene sin haberlo pedido. */
	isMuted(): boolean {
		try {
			const stored = localStorage.getItem(MUTED_KEY);
			return stored === null ? true : stored === 'true';
		} catch {
			return true;
		}
	}

	setMuted(muted: boolean): void {
		try {
			localStorage.setItem(MUTED_KEY, String(muted));
		} catch {
			// Modo privado o storage bloqueado: se queda en memoria.
		}
		this.#emit();
	}

	toggle(): void {
		const muted = !this.isMuted();
		this.setMuted(muted);
		if (!muted) this.play('toggleOn');
	}

	/** Avisa a la UI (un botón de toggle, por ejemplo) de que el estado cambió. */
	subscribe(listener: () => void): () => void {
		if (typeof window === 'undefined') return () => {};
		window.addEventListener(CHANGE_EVENT, listener);
		return () => window.removeEventListener(CHANGE_EVENT, listener);
	}

	play(cue: Cue): void {
		this.notes(CUES[cue]);
	}

	/** Nota n de una lista, subiendo por STEPS y saltando de octava al dar la vuelta. */
	detent(index: number): void {
		if (!this.#canHover()) return;
		const step = STEPS[index % STEPS.length] ?? G4;
		const freq = step * Math.pow(2, Math.floor(index / STEPS.length));
		this.notes([{ freq, freqEnd: freq * 0.84, duration: 0.05, gain: 0.8 }]);
	}

	/** Tick de hover, solo en dispositivos con ratón de verdad. */
	hover(): void {
		if (!this.#canHover()) return;
		this.play('hover');
	}

	notes(voices: readonly Voice[]): void {
		if (this.isMuted()) return;
		const ctx = this.#context();
		if (!ctx) return;

		const fire = () => {
			for (const voice of voices) this.#blip(ctx.currentTime + (voice.offset ?? 0), voice);
		};
		if (ctx.state === 'running') fire();
		else ctx.resume().then(fire).catch(() => {});
	}

	#canHover(): boolean {
		return this.#pointer?.matches ?? false;
	}

	#emit(): void {
		window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
	}

	#context(): AudioContext | null {
		if (this.#ctx) {
			if (this.#ctx.state === 'suspended') void this.#ctx.resume();
			return this.#ctx;
		}
		const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
		if (!Ctor) return null;

		this.#ctx = new Ctor();
		this.#master = this.#ctx.createGain();
		this.#master.gain.value = this.volume;
		this.#master.connect(this.#ctx.destination);
		return this.#ctx;
	}

	/**
	 * Portadora sine + modulador FM (el timbre de campana) + oscilador de filo,
	 * todo a través de un lowpass con envelope propio. El filtro cerrándose sobre
	 * el transitorio es lo que da el carácter de mazo sobre madera.
	 */
	#blip(t0: number, voice: Voice): void {
		const ctx = this.#ctx;
		const master = this.#master;
		if (!ctx || !master) return;

		const p = this.palette;
		const semitones = Math.pow(2, p.transpose / 12);
		const freq = voice.freq * semitones;
		const freqEnd = (voice.freqEnd ?? voice.freq) * semitones;
		const gain = (voice.gain ?? 1) * p.level;
		const duration = Math.max((voice.duration ?? 0.08) * p.decayMul, p.minDecay);

		const env = ctx.createGain();
		env.gain.setValueAtTime(0.0001, t0);
		env.gain.linearRampToValueAtTime(gain, t0 + p.attack);
		env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

		// Un scoop grande dura más, para que suba de tono en vez de sonar a golpe.
		const scoopTime = Math.min(0.02 + p.scoop * 0.6, duration * 0.8);
		const carrier = ctx.createOscillator();
		carrier.type = p.carrier;
		carrier.frequency.setValueAtTime(freq * (1 - p.scoop), t0);
		carrier.frequency.exponentialRampToValueAtTime(freqEnd, t0 + scoopTime);

		const mod = ctx.createOscillator();
		mod.type = 'sine';
		mod.frequency.value = freq * p.fmRatio;
		const modGain = ctx.createGain();
		modGain.gain.setValueAtTime(Math.max(freq * p.fmDepth, 1), t0);
		modGain.gain.exponentialRampToValueAtTime(1, t0 + duration);
		mod.connect(modGain).connect(carrier.frequency);

		const filter = ctx.createBiquadFilter();
		filter.type = 'lowpass';
		filter.Q.value = 0.8;
		filter.frequency.setValueAtTime(p.cutoff, t0);
		if (p.filterEnd < 0.99) {
			filter.frequency.exponentialRampToValueAtTime(
				Math.max(p.cutoff * p.filterEnd, 60),
				t0 + Math.max(duration * p.filterDecay, 0.02),
			);
		}

		carrier.connect(env);

		let edge: OscillatorNode | null = null;
		if (p.edgeLevel > 0.001) {
			edge = ctx.createOscillator();
			edge.type = p.edgeWave;
			edge.frequency.value = freq * p.edgeRatio;
			const edgeGain = ctx.createGain();
			edgeGain.gain.value = p.edgeLevel * gain;
			edge.connect(edgeGain).connect(env);
		}

		env.connect(filter).connect(master);

		const stop = t0 + duration + 0.05;
		carrier.start(t0);
		carrier.stop(stop);
		mod.start(t0);
		mod.stop(stop);
		edge?.start(t0);
		edge?.stop(stop);
	}
}

export const sound = new Sound();

/**
 * Un elemento puede tener varios bindings a la vez (por ejemplo un <details>
 * que además es hijo de una lista con detent), así que marcamos por tipo y no
 * por elemento.
 */
const bound = new WeakMap<Element, Set<string>>();

function claim(el: Element, kind: string): boolean {
	let kinds = bound.get(el);
	if (!kinds) {
		kinds = new Set();
		bound.set(el, kinds);
	}
	if (kinds.has(kind)) return false;
	kinds.add(kind);
	return true;
}

/**
 * Engancha los sonidos por atributo:
 *
 *   <a data-sound="nav">            suena al hacer click
 *   <a data-sound-hover>            tick al pasar el ratón
 *   <ul data-sound-detent>          cada hijo suena una nota más aguda
 *   <details data-sound-details>    "open" al abrir, "close" al cerrar
 *   <button data-sound-toggle>      mutea y desmutea
 *
 * El toggle recibe aria-pressed y data-sound-state ("on" | "muted") para que
 * puedas darle el aspecto que quieras desde CSS.
 *
 * Es idempotente: llamarla otra vez tras un cambio de DOM solo engancha lo nuevo.
 */
export function bindSoundAttributes(root: ParentNode = document): void {
	for (const el of root.querySelectorAll<HTMLElement>('[data-sound]')) {
		const cue = el.dataset.sound;
		if (!cue || !(cue in CUES) || !claim(el, 'click')) continue;
		el.addEventListener('click', () => sound.play(cue as Cue));
	}

	for (const el of root.querySelectorAll<HTMLElement>('[data-sound-hover]')) {
		if (!claim(el, 'hover')) continue;
		el.addEventListener('mouseenter', () => sound.hover());
	}

	for (const el of root.querySelectorAll<HTMLDetailsElement>('details[data-sound-details]')) {
		if (!claim(el, 'details')) continue;
		el.addEventListener('toggle', () => sound.play(el.open ? 'open' : 'close'));
	}

	for (const list of root.querySelectorAll<HTMLElement>('[data-sound-detent]')) {
		Array.from(list.children).forEach((child, index) => {
			if (!claim(child, 'detent')) return;
			child.addEventListener('mouseenter', () => sound.detent(index));
		});
	}

	for (const el of root.querySelectorAll<HTMLElement>('[data-sound-toggle]')) {
		if (!claim(el, 'toggle')) continue;
		const sync = () => {
			const muted = sound.isMuted();
			el.dataset.soundState = muted ? 'muted' : 'on';
			el.setAttribute('aria-pressed', String(!muted));
		};
		el.addEventListener('click', () => sound.toggle());
		sound.subscribe(sync);
		sync();
	}
}
