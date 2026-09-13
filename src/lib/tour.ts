/**
 * La visita guiada: una mano que señala y espera.
 *
 * No es una secuencia con cronómetro, es un guion que reacciona. Empieza
 * pidiendo que enciendas el sonido y se queda ahí esperando: si lo enciendes,
 * sigue y te presenta la foto; si en seis segundos no lo has hecho, se salta la
 * presentación y va directa a lo único que queda por contar, que las pegatinas
 * se arrastran. Insistir con lo demás a quien ya ha decidido que no quiere
 * sonido es hacerle perder el tiempo.
 *
 * Sale una vez y no vuelve. Un aviso de "esto se puede tocar" sirve la primera
 * vez; a partir de la segunda es un estorbo que tapa la página cada vez que
 * entras. Se apunta en localStorage nada más empezar, de modo que recargar a
 * mitad tampoco la repite.
 */

import { sound } from './sound';

const VISTO = 'portfolio:tour-seen';

/** Lo que espera antes de empezar, para dar tiempo a que todo esté puesto. */
const ARRANQUE = 900;
/** Lo que le da al usuario para encender el sonido antes de rendirse. */
const LIMITE_SONIDO = 6000;
/** Lo que se queda en cada sitio, ya parada. */
const PARADA = 1700;
/** La última se queda más: es la que pide hacer algo. */
const PARADA_FINAL = 2600;
/** Lo que tarda en ir de uno al siguiente. Cuadra con la transición del CSS. */
const VIAJE = 650;

/** Lo que mide el icono de la mano. Tiene que cuadrar con el CSS. */
const MANO = 22;

interface Paso {
	objetivo(): Element | null | undefined;
	texto: string;
	/**
	 * El dedo sobre el objetivo apuntando a su centro, en vez de debajo
	 * apuntando a su borde. Para una pegatina rodeada de otras pegatinas, señalar
	 * desde abajo señala a la de al lado.
	 */
	alCentro?: boolean;
}

const SONIDO: Paso = {
	objetivo: () => document.querySelector('[data-sound-toggle]'),
	texto: 'Turn the sound on',
};

const FOTO: Paso = {
	objetivo: () => document.querySelector('[data-tour-avatar]'),
	texto: 'That’s me',
};

const PEGATINA: Paso = {
	// La última de la lista es la que queda encima del montón, así que es la que
	// se ve entera y la que se agarraría de verdad.
	objetivo: () => [...document.querySelectorAll('[data-sticker]')].at(-1),
	texto: 'Drag the logos around',
	alCentro: true,
};

const dormir = (ms: number): Promise<void> => new Promise((listo) => setTimeout(listo, ms));

function yaVisto(): boolean {
	try {
		return localStorage.getItem(VISTO) === 'true';
	} catch {
		// Sin almacenamiento no hay forma de recordarlo, y machacar con la visita
		// en cada carga es peor que no darla.
		return true;
	}
}

function apuntarVisto(): void {
	try {
		localStorage.setItem(VISTO, 'true');
	} catch {
		// Da igual: si no se puede escribir, tampoco se pudo leer.
	}
}

export function bindTour(root: ParentNode = document): void {
	const capa = root.querySelector<HTMLElement>('[data-tour]');
	if (!capa || capa.dataset.tourBound !== undefined) return;

	// tour=1 la fuerza aunque ya se haya visto, que si no no hay manera de
	// volver a verla sin borrar el almacenamiento a mano.
	const forzada = new URLSearchParams(location.search).get('tour') === '1';
	if (!forzada && yaVisto()) return;
	if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

	const mano = capa.querySelector<HTMLElement>('.mano');
	const dicho = capa.querySelector<HTMLElement>('.dicho');
	if (!mano || !dicho) return;
	capa.dataset.tourBound = '';

	const corte = new AbortController();
	let cortada = false;

	const terminar = (): void => {
		if (cortada) return;
		cortada = true;
		corte.abort();
		capa.dataset.fuera = '';
		// Se quita del DOM cuando acaba de desvanecerse, no antes.
		setTimeout(() => {
			capa.hidden = true;
		}, 350);
	};

	/*
		Se va con el scroll y con el teclado, pero NO con un clic: la visita
		espera justo eso, que pulses el botón de sonido. Cancelar con el clic
		mataría el guion en el momento en que el usuario le está haciendo caso.

		El scroll sí, porque las tres cosas que señala están arriba: si te has ido
		de ahí, ya no señala nada.
	*/
	for (const tipo of ['keydown', 'wheel', 'touchmove'] as const) {
		window.addEventListener(tipo, terminar, { signal: corte.signal, passive: true });
	}

	const señalar = (objetivo: Element, texto: string, alCentro: boolean): void => {
		const caja = objetivo.getBoundingClientRect();
		const centroX = caja.left + caja.width / 2;
		// Apuntando al centro, la punta del dedo cae dentro del objetivo; si no,
		// la mano va debajo y la punta queda a un pelo de su borde de abajo.
		const manoY = alCentro ? caja.top + caja.height / 2 - 3 : caja.bottom + 6;

		mano.style.setProperty('--x', `${centroX - MANO / 2}px`);
		mano.style.setProperty('--y', `${manoY}px`);

		// El globo hay que escribirlo antes de medirlo, y medirlo antes de
		// centrarlo, porque lo ancho que sea depende de lo que ponga.
		dicho.textContent = texto;
		const ancho = dicho.offsetWidth;
		const izquierda = Math.min(Math.max(8, centroX - ancho / 2), window.innerWidth - ancho - 8);
		dicho.style.setProperty('--x', `${izquierda}px`);
		dicho.style.setProperty('--y', `${manoY + MANO + 10}px`);
		// El rabo apunta a la mano, no al medio del globo: contra el canto de la
		// pantalla el globo se desplaza y el rabo tiene que quedarse con ella.
		const rabo = Math.min(Math.max(12, centroX - izquierda), ancho - 12);
		dicho.style.setProperty('--rabo', `${rabo}px`);

		// Reiniciar la animación del toque: quitar el atributo no basta si se
		// vuelve a poner en el mismo fotograma, hay que forzar un reflujo entre
		// medias para que el navegador se entere de que es otra animación.
		delete mano.dataset.toca;
		void mano.offsetWidth;
		mano.dataset.toca = '';
	};

	let primera = true;

	/** Lleva la mano a un sitio y la deja ahí. Devuelve si sigue viva la visita. */
	const parada = async (paso: Paso, quedarse: number): Promise<boolean> => {
		const objetivo = paso.objetivo();
		if (!(objetivo instanceof Element)) return !cortada;

		// El primer sitio se pone sin transición, o la mano entraría volando desde
		// la esquina superior izquierda, que es donde está mientras no tiene sitio.
		if (primera) capa.dataset.quieto = '';
		señalar(objetivo, paso.texto, paso.alCentro === true);
		if (primera) {
			await new Promise(requestAnimationFrame);
			delete capa.dataset.quieto;
			primera = false;
		} else {
			await dormir(VIAJE);
		}
		if (cortada) return false;
		await dormir(quedarse);
		return !cortada;
	};

	/** Resuelve en cuanto el sonido se enciende, o a false si se acaba el tiempo. */
	const esperarSonido = (): Promise<boolean> =>
		new Promise((listo) => {
			const reloj = setTimeout(() => rendirse(false), LIMITE_SONIDO);
			let dejarDeMirar = (): void => {};
			const rendirse = (encendido: boolean): void => {
				clearTimeout(reloj);
				dejarDeMirar();
				listo(encendido);
			};
			dejarDeMirar = sound.subscribe(() => {
				if (!sound.isMuted()) rendirse(true);
			});
			// Si la visita se corta por otro lado, no dejarla colgada seis segundos.
			corte.signal.addEventListener('abort', () => rendirse(false));
		});

	void (async () => {
		await dormir(ARRANQUE);
		if (cortada) return;

		apuntarVisto();
		capa.hidden = false;

		/*
			El primer paso solo tiene sentido con el sonido apagado, que es como
			arranca la página. Si ya viene puesto, pedirlo sobra y se empieza por la
			foto.
		*/
		if (sound.isMuted()) {
			// Sin espera propia: lo que la mantiene ahí es el usuario.
			if (!(await parada(SONIDO, 0))) return;
			const encendido = await esperarSonido();
			if (cortada) return;
			if (encendido && !(await parada(FOTO, PARADA))) return;
		} else if (!(await parada(FOTO, PARADA))) {
			return;
		}

		if (!(await parada(PEGATINA, PARADA_FINAL))) return;
		terminar();
	})();
}
