/**
 * La visita guiada: una mano que señala y espera.
 *
 * No es una secuencia con cronómetro, es un guion que reacciona. Empieza
 * pidiendo que enciendas el sonido y se queda ahí esperando: si lo enciendes,
 * sigue y te presenta la foto; si en seis segundos no lo has hecho, se salta la
 * presentación y va directa a lo que queda por contar. Insistir con lo demás a
 * quien ya ha decidido que no quiere sonido es hacerle perder el tiempo.
 *
 * Y cuando termina no se olvida del todo: deja armado un último aviso, el de
 * cómo dar con él, que solo sale si el usuario se pone a bajar por la página.
 * Ese no va con el resto porque contesta a otra cosa: los demás enseñan qué
 * mirar, y este aparece cuando ya has mirado.
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
/** Las que piden hacer algo se quedan más. */
const PARADA_FINAL = 2600;
/** Lo que tarda en ir de uno al siguiente. */
const VIAJE = 650;

/**
 * Cuánto se arquea el trayecto, en partes de lo que mide. Una mano no va en
 * línea recta de un sitio a otro: sale, sube y baja donde va.
 */
const ARQUEO = 0.2;
/** Tope del arqueo, o un viaje largo daría la vuelta por el techo. */
const ARQUEO_MAX = 50;
/** Cuánto se ladea en lo más rápido del viaje, en grados. */
const LADEO = 16;
/** Fotogramas del trayecto. Entre uno y otro el navegador va en recta, así que
 *  con pocos se vuelve a ver la línea que queríamos quitar. */
const MUESTRAS = 20;

/** Intentos de ángulo antes de rendirse al de toda la vida, el de abajo. */
const INTENTOS = 14;
/** Lo que separa la punta del dedo del borde de lo que señala. */
const HUECO = 6;
/** Lo que separa el bocadillo de la mano. */
const HUECO_GLOBO = 8;

interface Sitio {
	x: number;
	y: number;
}

interface Paso {
	objetivo(): Element | null | undefined;
	texto: string;
	/**
	 * La punta del dedo en el centro del objetivo, en vez de fuera apuntando a
	 * su borde. Para una pegatina rodeada de otras pegatinas, señalar desde
	 * fuera señala a la de al lado.
	 */
	alCentro?: boolean;
	/** Qué mano sale. Un dedo señala cosas; un puño las agarra. */
	gesto?: 'apunta' | 'agarra';
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
	objetivo: () => document.querySelector('[data-sticker][title="React"]'),
	texto: 'Drag the logos around',
	alCentro: true,
	gesto: 'agarra',
};

const TRABAJO: Paso = {
	objetivo: () => document.querySelector('[data-tour-work]'),
	texto: 'Where I’ve worked, and what I’ve built',
};

const CONTACTO: Paso = {
	objetivo: () => document.querySelector('[data-tour-contacto]'),
	texto: 'Want to reach me? Use this',
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

/** Lo que hay del centro de un rectángulo a su borde, en la dirección dada. */
function alBorde(ancho: number, alto: number, dx: number, dy: number): number {
	const porX = Math.abs(dx) < 1e-6 ? Infinity : Math.abs(ancho / 2 / dx);
	const porY = Math.abs(dy) < 1e-6 ? Infinity : Math.abs(alto / 2 / dy);
	return Math.min(porX, porY);
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

	/** El guion principal. */
	const corte = new AbortController();
	/** El aviso de contacto, que le sobrevive. */
	const corteFinal = new AbortController();
	let cortada = false;
	/** El ángulo al que está la mano ahora, para poder ir girando hasta el nuevo. */
	let giroActual = 0;

	const mostrar = (): void => {
		capa.hidden = false;
		delete capa.dataset.fuera;
	};
	const esconder = (): void => {
		capa.dataset.fuera = '';
		// Se quita del DOM cuando acaba de desvanecerse, no antes.
		setTimeout(() => {
			capa.hidden = true;
		}, 350);
	};

	const donde = (el: HTMLElement): Sitio => ({
		x: parseFloat(el.style.getPropertyValue('--x')) || 0,
		y: parseFloat(el.style.getPropertyValue('--y')) || 0,
	});

	/**
	 * El viaje de un sitio a otro, fotograma a fotograma.
	 *
	 * En recta y a velocidad de transición el movimiento se lee como lo que es,
	 * una interpolación. Aquí el trayecto se arquea y la mano se ladea con la
	 * prisa que lleva, como si algo tirara de ella, y se endereza al llegar.
	 */
	const viajar = (
		el: HTMLElement,
		desde: Sitio,
		hasta: Sitio,
		giroDesde: number,
		giroHasta: number,
	): void => {
		const dx = hasta.x - desde.x;
		const dy = hasta.y - desde.y;
		const largo = Math.hypot(dx, dy);
		if (largo < 1) return;

		// Perpendicular al trayecto, y siempre hacia arriba: la mano pasa por
		// encima de lo que hay entre los dos sitios, no por debajo.
		let px = -dy / largo;
		let py = dx / largo;
		if (py > 0) {
			px = -px;
			py = -py;
		}
		const desvio = Math.min(largo * ARQUEO, ARQUEO_MAX);

		const puntos: Sitio[] = [];
		const avances: number[] = [];
		for (let i = 0; i <= MUESTRAS; i++) {
			const t = i / MUESTRAS;
			// Sinusoidal: arranca y termina parada, sin el tirón de una recta.
			const avance = (1 - Math.cos(Math.PI * t)) / 2;
			// El seno al cuadrado y no el seno: los dos valen cero en las puntas,
			// pero este además llega con pendiente cero, así que el arco no deja
			// una velocidad lateral suelta justo al aterrizar.
			const campana = Math.sin(Math.PI * t) ** 2;
			avances.push(avance);
			puntos.push({
				x: desde.x + dx * avance + px * desvio * campana,
				y: desde.y + dy * avance + py * desvio * campana,
			});
		}

		/*
			El ladeo sale de lo deprisa que va de lado en ese instante, no de hacia
			dónde va en total. Con el total, un salto casi vertical salía derecho
			como una vela por mucho que el arco lo llevara de lado: lo que tuerce la
			mano es el camino que está haciendo, y el camino va curvo.

			Encima del ladeo va el giro de orientación, que es otra cosa: pasar de
			cómo estaba apuntando a cómo va a apuntar. Ese sí sigue al avance.
		*/
		const referencia = ((Math.PI / 2) * largo) / MUESTRAS;
		const marcos = puntos.map((p, i) => {
			const anterior = puntos[Math.max(0, i - 1)];
			const siguiente = puntos[Math.min(MUESTRAS, i + 1)];
			const deLado = (siguiente.x - anterior.x) / 2;
			// Quieta en las dos puntas, pase lo que pase con la diferencia finita.
			const enMarcha = i > 0 && i < MUESTRAS;
			const ladeo = enMarcha ? Math.max(-1, Math.min(1, deLado / referencia)) * LADEO : 0;
			// Por el camino corto: de -170 a 170 son 20 grados, no 340.
			const vuelta = (((giroHasta - giroDesde + 540) % 360) - 180) * avances[i];
			const base = giroDesde + vuelta;
			return { transform: `translate(${p.x}px, ${p.y}px) rotate(${base + ladeo}deg)` };
		});
		// Lineal a propósito: el ritmo ya va metido en los fotogramas.
		el.animate(marcos, { duration: VIAJE, easing: 'linear' });
	};

	/**
	 * Elige por dónde se acerca la mano, y de paso dónde cae el bocadillo.
	 *
	 * El ángulo es al azar en cada parada, que señalar siempre desde abajo se
	 * nota mecánico a la tercera. Vale el círculo entero: si la mano viene de
	 * arriba, señala hacia abajo y el globo se le pone encima, nunca entre ella y
	 * lo que está señalando.
	 *
	 * Pero no vale cualquier ángulo: cerca de un canto de la pantalla se saldría
	 * la mano, o el globo, que es más ancho que ella. Se prueban unos cuantos y
	 * se coge el primero que quepa entero. Si ninguno cabe, por abajo, que es lo
	 * que siempre funcionó.
	 */
	const acercarse = (
		caja: DOMRect,
		alCentro: boolean,
		lado: number,
		anchoGlobo: number,
		altoGlobo: number,
	) => {
		const centroX = caja.left + caja.width / 2;
		const centroY = caja.top + caja.height / 2;

		const disponer = (grados: number) => {
			const rad = (grados * Math.PI) / 180;
			const ux = Math.cos(rad);
			const uy = Math.sin(rad);
			// Lo que se aleja del centro: media mano si la punta va al centro, y si
			// no, hasta el borde del objetivo más media mano y el hueco.
			const fuera = alCentro
				? lado / 2
				: alBorde(caja.width, caja.height, ux, uy) + lado / 2 + HUECO;
			/*
				El icono apunta hacia arriba, así que el giro es el que lleva ese
				arriba a mirar hacia el objetivo. Girando un ángulo g, el (0,-1) del
				icono acaba en (sen g, -cos g), y lo queremos igual a la dirección de
				vuelta al centro, que es (-cos a, -sen a).
			*/
			const giro = (Math.atan2(-ux, uy) * 180) / Math.PI;
			const manoX = centroX + ux * fuera;
			const manoY = centroY + uy * fuera;
			// Una mano girada ocupa de alto más que su caja: hay que contar esa
			// diferencia o el globo se le mete dentro.
			const rad2 = (giro * Math.PI) / 180;
			const medioAlto = (lado / 2) * (Math.abs(Math.cos(rad2)) + Math.abs(Math.sin(rad2)));

			// uy positivo es la mano por debajo del objetivo, así que el globo baja
			// todavía más y el rabo le sale por arriba. Y al revés.
			const debajo = uy >= 0;
			const globoY = debajo
				? manoY + medioAlto + HUECO_GLOBO
				: manoY - medioAlto - HUECO_GLOBO - altoGlobo;
			const globoX = Math.min(
				Math.max(8, manoX - anchoGlobo / 2),
				window.innerWidth - anchoGlobo - 8,
			);

			return {
				sitio: { x: manoX - lado / 2, y: manoY - lado / 2 },
				globo: { x: globoX, y: globoY },
				centro: { x: manoX, y: manoY },
				giro,
				rabo: debajo ? 'arriba' : 'abajo',
			};
		};

		// La mano girada ocupa como mucho su diagonal. Con eso basta para saber si
		// se sale por algún lado.
		const radio = (lado * Math.SQRT2) / 2;
		const cabe = (d: ReturnType<typeof disponer>): boolean =>
			d.centro.x - radio >= 4 &&
			d.centro.x + radio <= window.innerWidth - 4 &&
			d.centro.y - radio >= 4 &&
			d.centro.y + radio <= window.innerHeight - 4 &&
			d.globo.y >= 4 &&
			d.globo.y + altoGlobo <= window.innerHeight - 4;

		for (let i = 0; i < INTENTOS; i++) {
			const salida = disponer(Math.random() * 360);
			if (cabe(salida)) return salida;
		}
		return disponer(90);
	};

	const colocar = (objetivo: Element, paso: Paso, conViaje: boolean): void => {
		mano.dataset.gesto = paso.gesto ?? 'apunta';
		const antesMano = donde(mano);
		const antesGlobo = donde(dicho);
		const giroAnterior = giroActual;

		// El lado lo dice el elemento y no una constante: en móvil la hoja de
		// estilos agranda la mano.
		const lado = mano.offsetHeight;

		// El globo se escribe y se mide antes de elegir por dónde acercarse,
		// porque lo que mida entra en la cuenta de por dónde cabe: un bocadillo
		// ancho no cabe donde cabría la mano sola.
		dicho.textContent = paso.texto;
		const anchoGlobo = dicho.offsetWidth;
		const altoGlobo = dicho.offsetHeight;

		const caja = objetivo.getBoundingClientRect();
		const puesto = acercarse(caja, paso.alCentro === true, lado, anchoGlobo, altoGlobo);
		giroActual = puesto.giro;

		for (const [el, destino] of [
			[mano, puesto.sitio],
			[dicho, puesto.globo],
		] as const) {
			el.style.setProperty('--x', `${destino.x}px`);
			el.style.setProperty('--y', `${destino.y}px`);
		}
		mano.style.setProperty('--giro', `${puesto.giro}deg`);
		dicho.dataset.rabo = puesto.rabo;
		// El rabo apunta a la mano, no al medio del globo: contra el canto de la
		// pantalla el globo se desplaza y el rabo tiene que quedarse con ella.
		const rabo = Math.min(Math.max(12, puesto.centro.x - puesto.globo.x), anchoGlobo - 12);
		dicho.style.setProperty('--rabo', `${rabo}px`);

		if (!conViaje) return;
		viajar(mano, antesMano, puesto.sitio, giroAnterior, puesto.giro);
		// El bocadillo no se ladea ni gira: torcido no es inercia, es un fallo.
		viajar(dicho, antesGlobo, puesto.globo, 0, 0);
	};

	/** El toque o el tirón, según la mano que toque. */
	const gesticular = (): void => {
		// Quitar el atributo no basta si se vuelve a poner en el mismo fotograma:
		// hay que forzar un reflujo entre medias para que el navegador se entere
		// de que es otra animación y no la misma siguiendo.
		delete mano.dataset.toca;
		void mano.offsetWidth;
		mano.dataset.toca = '';
	};

	/*
		El aviso de cómo dar con él. Va aparte del guion y solo después de que el
		usuario se ponga a bajar: los demás pasos enseñan qué mirar, y este
		aparece cuando ya has mirado. Soltarlo nada más terminar la visita sería
		otro paso más, y el usuario no ha hecho nada que lo pida.
	*/
	const armarContacto = (): void => {
		window.addEventListener(
			'scroll',
			() => {
				const objetivo = CONTACTO.objetivo();
				if (!(objetivo instanceof Element)) return;
				// Y solo cuando el enlace está de verdad a la vista: señalar algo que
				// está fuera de la pantalla es señalar a la nada.
				const mirar = new IntersectionObserver(
					(entradas) => {
						if (!entradas.some((e) => e.isIntersecting)) return;
						mirar.disconnect();
						void (async () => {
							mostrar();
							colocar(objetivo, CONTACTO, false);
							gesticular();
							await dormir(PARADA_FINAL);
							esconder();
							corteFinal.abort();
						})();
					},
					{ threshold: 0.9 },
				);
				mirar.observe(objetivo);
				corteFinal.signal.addEventListener('abort', () => mirar.disconnect());
			},
			{ once: true, passive: true, signal: corteFinal.signal },
		);
	};

	const parar = (): void => {
		if (cortada) return;
		cortada = true;
		corte.abort();
		esconder();
		armarContacto();
	};

	/*
		Se va con el scroll y con el teclado, pero NO con un clic: la visita
		espera justo eso, que pulses el botón de sonido. Cancelar con el clic
		mataría el guion en el momento en que el usuario le está haciendo caso.

		El scroll sí, porque lo que señala está arriba: si te has ido de ahí, ya no
		señala nada. Y ese mismo scroll es el que deja armado el aviso de contacto,
		así que irse de la visita no es perdérselo todo.
	*/
	for (const tipo of ['keydown', 'wheel', 'touchmove'] as const) {
		window.addEventListener(tipo, parar, { signal: corte.signal, passive: true });
	}

	let primera = true;

	/** Lleva la mano a un sitio y la deja ahí. Devuelve si sigue viva la visita. */
	const parada = async (paso: Paso, quedarse: number): Promise<boolean> => {
		const objetivo = paso.objetivo();
		if (!(objetivo instanceof Element)) return !cortada;

		// El primer sitio se pone y ya: no hay de dónde venir.
		colocar(objetivo, paso, !primera);
		if (primera) {
			primera = false;
		} else {
			await dormir(VIAJE);
			if (cortada) return false;
		}
		// El gesto, al llegar. Haciéndolo al salir, la mano señalaba en el aire.
		gesticular();
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
		mostrar();

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
		if (!(await parada(TRABAJO, PARADA))) return;
		parar();
	})();
}
