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
	/**
	 * Despegar una pegatina y volver a pegarla. Sube una cuarta y baja una
	 * quinta, que son los dos intervalos de la paleta, y flojitas: se agarra y se
	 * suelta muchas veces seguidas y a volumen entero cansarían.
	 */
	grab: [
		{ freq: A3, duration: 0.045, gain: 0.55 },
		{ freq: D4, duration: 0.06, offset: 0.03, gain: 0.55 },
	],
	/** Al soltarla cae a la nota más grave que hay, y se deja apoyar más rato. */
	place: [
		{ freq: A3, duration: 0.045, gain: 0.6 },
		{ freq: D3, duration: 0.11, offset: 0.03, gain: 0.6 },
	],
	/** Tres clicks percusivos, como el scroll de página del menú de Wii. */
	scroll: [0, 1, 2].map((i) => ({ freq: D4, duration: 0.035, gain: 0.75 - i * 0.13, offset: i * 0.045 })),
	/**
	 * La mano de la visita, al señalar. Dos toques, uno por cada vez que el dedo
	 * baja, y el segundo más flojo: es el mismo gesto perdiendo fuerza.
	 *
	 * Arriba del todo del registro y muy cortos, que es la punta de un dedo
	 * tocando algo, no un golpe.
	 */
	point: [
		{ freq: D5, duration: 0.035, gain: 0.45, offset: 0.2 },
		{ freq: D5, duration: 0.035, gain: 0.3, offset: 0.7 },
	],
	/**
	 * La mano de la visita, al fingir que arrastra. Un barrido por cada vez que
	 * el puño llega a un lado: sube una cuarta al ir y la baja al volver.
	 *
	 * Con barrido y no con notas sueltas porque lo que se está contando es que
	 * algo se lleva de un sitio a otro, y un tono que se desliza es eso.
	 *
	 * Cuatro y no dos: el puño hace dos idas y venidas, y los desfases son los
	 * de sus extremos. Con dos, el segundo viaje iba en silencio. Los del
	 * segundo van más flojos, que es el mismo gesto perdiendo fuerza.
	 */
	drag: [
		{ freq: A3, freqEnd: D4, duration: 0.12, gain: 0.45, offset: 0.27 },
		{ freq: D4, freqEnd: A3, duration: 0.12, gain: 0.35, offset: 0.63 },
		{ freq: A3, freqEnd: D4, duration: 0.12, gain: 0.3, offset: 1.17 },
		{ freq: D4, freqEnd: A3, duration: 0.12, gain: 0.22, offset: 1.53 },
	],
	/** Suena al desmutear, para confirmar que el audio funciona. */
	toggleOn: [D3, G3, D4, G4].map((freq, i) => ({ freq, duration: 0.09, offset: i * 0.06 })),
} satisfies Record<string, Voice[]>;

export type Cue = keyof typeof CUES;

/** Se exporta porque el botón la necesita en su script en línea, que corre
 *  antes que nada de esto para no pintar un estado que va a cambiar. */
export const MUTED_KEY = 'portfolio:sound-muted';
const CHANGE_EVENT = 'portfolio:sound-change';

/**
 * Lo que se adelanta cada nota al programarla, en segundos.
 *
 * Programar en ctx.currentTime es programar en el pasado en cuanto el reloj
 * avance un solo bloque entre que se lee y que se renderiza, y una nota entera
 * de las de aquí dura noventa milisegundos: si el reloj da un salto, la
 * envolvente ya se ha consumido y lo que sale es silencio. Doce milisegundos no
 * se oyen —la latencia del sistema ya es mayor— y dejan la nota siempre por
 * delante del reloj.
 */
const ADELANTO = 0.012;

/** Lo que quedó guardado de la última visita. Sin nada, o sin poder leerlo,
 *  muteado: es lo único que se puede dar por supuesto sin molestar a nadie. */
function leerGuardado(): boolean {
	try {
		return localStorage.getItem(MUTED_KEY) !== 'false';
	} catch {
		return true;
	}
}

class Sound {
	palette: Palette = MADERA;
	volume = 0.16;

	#ctx: AudioContext | null = null;
	#master: GainNode | null = null;
	#pointer: MediaQueryList | null = null;
	/**
	 * El estado manda desde aquí, y localStorage solo lo recuerda entre visitas.
	 *
	 * Antes la verdad estaba en el almacenamiento y se leía en cada nota, con un
	 * catch que devolvía "muteado". Donde el almacenamiento está bloqueado, y en
	 * un móvil pasa más de lo que parece (modo privado, prevención de rastreo,
	 * bloqueo por sitio), eso dejaba el sonido apagado para siempre: escribir
	 * fallaba en silencio y la siguiente lectura volvía a decir que sí, que
	 * muteado. El botón cambiaba de dibujo y no sonaba nada.
	 */
	#muted = true;
	/**
	 * Si el audio está desbloqueado DE VERDAD, comprobado y no supuesto.
	 *
	 * No se puede preguntar por ctx.state: en iOS el contexto dice running y
	 * sigue mudo. La única prueba es reproducir algo y ver que termina.
	 */
	#desbloqueado = false;

	constructor() {
		if (typeof window === 'undefined') return;

		this.#pointer = window.matchMedia('(hover: hover) and (pointer: fine)');
		this.#muted = leerGuardado();

		/*
			Desbloquear el audio, que en un móvil no basta con crearlo.

			Un AudioContext nacido fuera de un gesto arranca parado, y solo se le
			puede quitar la parada desde dentro de un gesto. Antes esto se hacía con
			escuchas de un solo uso que además únicamente CREABAN el contexto: si el
			primer toque de la visita caía en cualquier otro sitio de la página, el
			contexto nacía parado y el único gesto que podía arrancarlo ya se había
			gastado. El botón del sonido no volvía a sonar en toda la visita.

			Ahora lo intenta cada gesto, y las escuchas se quedan: en un móvil el
			sistema vuelve a parar el contexto cada dos por tres (una llamada, otra
			app, la pantalla apagándose) y este es el camino de vuelta. Son tres
			escuchas pasivas que casi siempre se van por la primera comparación.
		*/
		const despertar = (): void => this.#desbloquear();
		/*
			Los cuatro de howler, que lleva una década peleándose con esto, más
			pointerdown que no estorba. Hacen falta los cuatro porque cada plataforma
			desbloquea con uno distinto: iOS con touchend de toda la vida, el
			escritorio con click. Nosotros teníamos pointerdown, keydown y
			touchstart, o sea ni touchend ni click.

			En captura y en document, para llegar antes que cualquier manejador que
			pare la propagación por el camino.
		*/
		for (const type of ['touchstart', 'touchend', 'click', 'keydown', 'pointerdown'] as const) {
			document.addEventListener(type, despertar, { capture: true, passive: true });
		}

		/*
			Al volver a la pestaña. Sin esto, cambiar de app y volver deja la página
			muda aunque el botón siga diciendo que el sonido está puesto.

			pageshow además, porque al volver con el botón de atrás la página sale de
			la caché hacia atrás y no siempre pasa por un cambio de visibilidad.
		*/
		const reanimar = (): void => {
			const ctx = this.#ctx;
			if (!ctx) return;
			// Una interrupción vuelve a dejarlo bloqueado, así que el siguiente gesto
			// tiene que volver a pagar el desbloqueo.
			this.#desbloqueado = false;
			if (ctx.state !== 'running') void ctx.resume().catch(() => {});
		};
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'visible') reanimar();
		});
		window.addEventListener('pageshow', reanimar);

		// Si el usuario mutea en otra pestaña, esta se entera.
		window.addEventListener('storage', (e) => {
			if (e.key !== MUTED_KEY) return;
			this.#muted = e.newValue === null ? true : e.newValue === 'true';
			this.#emit();
		});
	}

	/** Arranca muteado: nadie quiere que una web suene sin haberlo pedido. */
	isMuted(): boolean {
		return this.#muted;
	}

	setMuted(muted: boolean): void {
		this.#muted = muted;
		try {
			localStorage.setItem(MUTED_KEY, String(muted));
		} catch {
			// Modo privado o bloqueado: no se recordará, pero esta visita suena.
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

	/**
	 * Gota de agua, con el timbre de la paleta.
	 *
	 * Usa el mismo FM, filo y envelope de filtro que blip(), para que suene a
	 * la misma familia que el resto. Lo que no puede salir de la paleta es lo
	 * que define una gota: el barrido de tono hacia arriba, el sonido de la
	 * cavidad de aire cerrándose. El scoop de blip() llega al 4%; aquí el tono
	 * sube de G3 a D5, y por eso tiene voz propia.
	 */
	drop(): void {
		if (this.isMuted()) return;
		const ctx = this.#context();
		if (!ctx) return;

		const fire = () => this.#dropVoice(ctx.currentTime + ADELANTO);
		if (ctx.state === 'running') fire();
		else ctx.resume().then(fire).catch(() => {});
	}

	#dropVoice(t0: number): void {
		const ctx = this.#ctx;
		const master = this.#master;
		if (!ctx || !master) return;

		const p = this.palette;
		// Dos gotas seguidas nunca suenan igual. Poco margen para no salirse
		// del registro del resto.
		const jitter = 0.94 + Math.random() * 0.12;
		const from = 196 * jitter; // G3
		const to = 587.33 * jitter; // D5, una nota de la escala
		const dur = 0.2;

		const env = ctx.createGain();
		env.gain.setValueAtTime(0.0001, t0);
		env.gain.linearRampToValueAtTime(0.42, t0 + p.attack);
		env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

		const carrier = ctx.createOscillator();
		carrier.type = p.carrier;
		carrier.frequency.setValueAtTime(from, t0);
		carrier.frequency.exponentialRampToValueAtTime(to, t0 + 0.11);

		// El mismo FM que da el timbre de la paleta, sobre el tono que sube.
		// FM a un tercio de la paleta: a profundidad completa el tono deja de ser
		// limpio y la gota empieza a sonar a hueco.
		const mod = ctx.createOscillator();
		mod.type = 'sine';
		mod.frequency.value = to * p.fmRatio;
		const modGain = ctx.createGain();
		modGain.gain.setValueAtTime(Math.max(to * p.fmDepth * 0.3, 1), t0);
		modGain.gain.exponentialRampToValueAtTime(1, t0 + dur);
		mod.connect(modGain).connect(carrier.frequency);

		// El filtro apenas se mueve. Cerrarlo como en la paleta (de 5000 a 900)
		// es lo que hacía que sonara metida en una botella: el tono sube pero
		// queda tapado, y el oído lo lee como una cavidad cerrada.
		const filter = ctx.createBiquadFilter();
		filter.type = 'lowpass';
		filter.Q.value = 0.7;
		filter.frequency.setValueAtTime(p.cutoff * 1.6, t0);
		filter.frequency.exponentialRampToValueAtTime(p.cutoff * 0.9, t0 + dur);

		carrier.connect(env);

		let edge: OscillatorNode | null = null;
		if (p.edgeLevel > 0.001) {
			edge = ctx.createOscillator();
			edge.type = p.edgeWave;
			edge.frequency.setValueAtTime(from * p.edgeRatio, t0);
			edge.frequency.exponentialRampToValueAtTime(to * p.edgeRatio, t0 + 0.11);
			const edgeGain = ctx.createGain();
			edgeGain.gain.value = p.edgeLevel * 0.18;
			edge.connect(edgeGain).connect(env);
		}

		env.connect(filter).connect(master);

		const stop = t0 + dur + 0.05;
		carrier.start(t0);
		carrier.stop(stop);
		mod.start(t0);
		mod.stop(stop);
		edge?.start(t0);
		edge?.stop(stop);
	}

	notes(voices: readonly Voice[]): void {
		if (this.isMuted()) return;
		const ctx = this.#context();
		if (!ctx) return;

		const fire = () => {
			const t0 = ctx.currentTime + ADELANTO;
			for (const voice of voices) this.#blip(t0 + (voice.offset ?? 0), voice);
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

	/**
	 * Desbloquear el audio de verdad, y comprobar que se ha desbloqueado.
	 *
	 * En iOS el audio nace bloqueado y solo lo abre un sonido reproducido dentro
	 * de un gesto. Ese sonido se pierde: es el que paga el desbloqueo. La idea de
	 * cebarlo con un búfer mudo para que pague él era la buena, pero estaba mal
	 * puesta y no pagaba nada:
	 *
	 * - Se cebaba al crear el contexto, que en iOS nace parado, así que el búfer
	 *   no llegaba a renderizarse. Ahora se reanuda ANTES, y se vuelve a reanudar
	 *   después, que reanudar dentro de la pila de un gesto es lo que desbloquea
	 *   en Android.
	 * - Y se daba por bueno en cuanto ctx.state decía running. En iOS dice
	 *   running y sigue mudo, así que no se volvía a intentar nunca más y el
	 *   primero que pagaba era el primer sonido de verdad. Como el de las
	 *   pegatinas no sale de un manejador de eventos sino del tic de la física,
	 *   era justo el que más papeletas tenía. De ahí que arrastrar una nada más
	 *   recargar no sonara y que luego, tras cualquier otra cosa que sonara, ya
	 *   sonara todo.
	 *
	 * La prueba es onended: si el búfer termina, es que ha sonado, y entonces sí
	 * está desbloqueado. Hasta entonces se reintenta en cada gesto.
	 *
	 * El búfer va a 22050 y no a la frecuencia del contexto porque es lo que hace
	 * howler, que se ha comido todos los bugs de esto antes que nosotros.
	 */
	#desbloquear(): void {
		if (this.#desbloqueado) return;
		const ctx = this.#context();
		if (!ctx) return;

		try {
			if (ctx.state !== 'running') void ctx.resume().catch(() => {});

			const fuente = ctx.createBufferSource();
			fuente.buffer = ctx.createBuffer(1, 1, 22050);
			fuente.connect(ctx.destination);
			fuente.start(0);

			if (ctx.state !== 'running') void ctx.resume().catch(() => {});

			fuente.onended = () => {
				fuente.disconnect();
				this.#desbloqueado = true;
			};
		} catch {
			// Si ni eso se puede, no hay nada que hacer desde aquí.
		}
	}

	#context(): AudioContext | null {
		if (this.#ctx) {
			// No se compara con 'suspended': WebKit tiene además 'interrupted', que
			// es donde deja el contexto una llamada o cualquier otro audio del
			// sistema, y ahí también hay que pedirle que vuelva.
			if (this.#ctx.state !== 'running') void this.#ctx.resume();
			return this.#ctx;
		}
		const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
		if (!Ctor) return null;

		/*
			Qué clase de audio es este, que en iOS lo cambia todo.

			Sin decir nada, WebKit trata cualquier audio como si fuera el principal
			de la página: al primer pitido interrumpe lo que estuviera sonando en el
			teléfono. Alguien escuchando música que toca el botón del sonido se queda
			sin música, y encima esa interrupción deja el contexto suspendido hasta
			que haya otro gesto. Un blip de interfaz no merece eso.

			'ambient' es justo esta categoría: se mezcla con lo que ya suena, no
			interrumpe a nadie y no hay interrupción que recuperar.

			Lo que 'ambient' no hace es saltarse el interruptor de silencio del
			iPhone, y es a propósito: si el teléfono está en silencio, callarse es lo
			correcto. Eso explica que el mismo iPhone suene o no según cómo lo lleve
			su dueño. Si algún día se quiere lo contrario, la palabra es 'playback',
			pero se lleva por delante la música de quien visite la página.
		*/
		const sesion = (navigator as { audioSession?: { type: string } }).audioSession;
		if (sesion) {
			try {
				sesion.type = 'ambient';
			} catch {
				// Categoría no admitida: se queda con la de por defecto.
			}
		}

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
