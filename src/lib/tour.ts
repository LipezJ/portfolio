/**
 * La visita guiada: una mano que señala y espera.
 *
 * No es una secuencia con cronómetro, es un guion que reacciona. Empieza
 * pidiendo que enciendas el sonido y se queda ahí esperando, no pasa sola: si
 * lo enciendes sigue al momento, y si en seis segundos no lo has hecho sigue
 * igual. Lo demás va en orden de presentación, quién soy, dónde he trabajado,
 * qué he hecho y con qué, y no depende de esa respuesta.
 *
 * Y cuando termina no se olvida del todo: deja armado un último aviso, el de
 * cómo dar con él, que sale cuando el enlace del final está a la vista. Ese no
 * va con el resto porque contesta a otra cosa: los demás enseñan qué mirar, y
 * este aparece cuando ya has mirado.
 *
 * Sale una vez y no vuelve. Un aviso de "esto se puede tocar" sirve la primera
 * vez; a partir de la segunda es un estorbo que tapa la página cada vez que
 * entras. Se apunta en localStorage nada más empezar, de modo que recargar a
 * mitad tampoco la repite.
 */

import { sound } from './sound';

const VISTO = 'portfolio:tour-seen';

/** Lo que espera antes de empezar, para dar tiempo a que todo esté puesto. */
const ARRANQUE = 400;
/** Lo que le da al usuario para encender el sonido antes de rendirse. */
const LIMITE_SONIDO = 6000;
/** Lo que se queda en cada sitio, ya parada. */
const PARADA = 1700;
/** Las que piden hacer algo se quedan más. */
const PARADA_FINAL = 2600;
/**
 * Lo que dura el saludo de quien ya vio la visita entera.
 *
 * Más que ninguna otra parada porque es la única que pide algo: hay que leerla,
 * caer en que la foto se pulsa, y decidirse. Con el tiempo de una parada normal
 * se va antes de que dé tiempo a lo segundo.
 */
const PARADA_INVITACION = 4200;
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

/**
 * Cada cuántos grados se prueba un ángulo alrededor de la diana.
 *
 * Se barre el círculo entero en vez de tirar dados. Con ángulos al azar, el
 * hueco bueno alrededor de algo pegado a una esquina puede ser una ventana de
 * treinta grados, y unas cuantas tiradas la fallan de vez en cuando: el efecto
 * era que la misma parada salía bien casi siempre y mal una de cada tantas, que
 * es lo peor de depurar. Con paso de diez no se falla ninguna ventana que
 * quepa. El desorden se conserva barajando el barrido.
 */
const PASO_ANGULO = 10;
/** Lo que separa la punta del dedo del borde de lo que señala. */
const HUECO = 6;

/**
 * Dónde tiene la punta cada mano, en partes de su lado y desde su centro.
 *
 * Medido rasterizando los dos iconos y buscando el píxel más alto: en una caja
 * de 64, el dedo de hand-pointer acaba en (26,5 · 6) y no en (32 · 6). Está
 * corrido a la izquierda, y por eso hace falta el dato: sin él, la punta no cae
 * donde se cree y se señala descentrado.
 *
 * Ojo con lo que NO es esto: dónde está la punta y hacia dónde apunta el dedo
 * son cosas distintas. La línea que une el centro del icono con su punta va
 * doce grados torcida, pero el dedo es vertical, medido siguiendo el centro de
 * sus filas de arriba: sale con medio grado de inclinación. Tomar esa línea
 * como la dirección es lo que hacía que la mano mirase hacia afuera en vez de a
 * lo que estaba señalando.
 */
const PUNTA = {
	apunta: { x: -0.086, y: -0.406 },
	agarra: { x: 0.008, y: -0.406 },
} as const;
/** Lo que separa el bocadillo de la mano. */
const HUECO_GLOBO = 8;
/** Lo que se le tolera al rabo desviarse de la mano, en píxeles. Por encima de
 *  eso ya no apunta a ella y se busca otro ángulo. */
const DESVIO_RABO_MAX = 3;
/** Lo que calla entre el final de la visita y el aviso de contacto. */
const RESPIRO = 1200;

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
	/**
	 * Lo que el bocadillo no debe tapar, además de la diana misma.
	 *
	 * Señalando un puesto, la diana es su nombre, y el globo tiene vía libre para
	 * sentarse encima del puesto de al lado. Pero se está hablando de los dos.
	 */
	evitar?(): Iterable<Element>;
	/**
	 * Lo que se queda en pantalla, si lo suyo no es lo de todas.
	 *
	 * Por defecto una parada dura lo mismo que las demás y la última un poco
	 * más. Esto es para la que además de leerse pide decidirse a algo.
	 */
	espera?: number;
}

const SONIDO: Paso = {
	objetivo: () => document.querySelector('[data-sound-toggle]'),
	texto: 'Turn the sound on',
};

const FOTO: Paso = {
	objetivo: () => document.querySelector('[data-tour-avatar]'),
	texto: 'That’s me',
};

/**
 * La misma foto, para quien ya la ha visto entera.
 *
 * Sin esto, volver a verla es un secreto: la visita corta no dice en ninguna
 * parte que la foto se pueda pulsar, así que nadie que no lo pruebe por
 * casualidad se entera de que hay más.
 *
 * Y no repite el "that's me" de la otra, aunque señale lo mismo: si lo dijera,
 * al pulsar saldría dos veces seguidas la misma frase señalando la misma cara.
 * Este saluda e invita, y presentarse ya lo hace el primer paso de la visita.
 */
const FOTO_OTRA_VEZ: Paso = {
	...FOTO,
	texto: 'Hey, tap for the tour',
	espera: PARADA_INVITACION,
};

const PEGATINA: Paso = {
	objetivo: () => document.querySelector('[data-sticker][title="React"]'),
	texto: 'Some of my stack, drag it',
	alCentro: true,
	gesto: 'agarra',
};

const TRABAJO: Paso = {
	/*
		El nombre del primer puesto, no el rótulo "Work" ni la fila entera.

		Con la fila, el renglón más ancho va del nombre a la fecha y su centro cae
		justo en la fecha: la mano acababa señalando "2024 - Present". Lo que
		identifica el puesto es el nombre.
	*/
	objetivo: () => document.querySelector('[data-tour-work] [data-entry-name]'),
	texto: 'Where I’ve worked',
	/*
		El bloque entero y su rótulo. El bloque porque se señala uno y se habla de
		todos; el rótulo porque es lo que dice de qué sección se está hablando: con
		el globo encima, la mano parece señalar un puesto suelto en vez de la
		sección.
	*/
	evitar: () => document.querySelectorAll('[data-tour-work], [data-tour-titulo="work"]'),
};

const PROYECTOS: Paso = {
	objetivo: () => document.querySelector('[data-tour-proyectos] [data-entry-name]'),
	texto: 'And what I’ve built on my own',
	evitar: () =>
		document.querySelectorAll('[data-tour-proyectos], [data-tour-titulo="proyectos"]'),
};

const BLOG: Paso = {
	objetivo: () => document.querySelector('[data-tour-blog]'),
	texto: 'I write about it here',
	// Las dos líneas del final, que están justo debajo y son la despedida.
	evitar: () => document.querySelectorAll('[data-tour-final]'),
};

const CONTACTO: Paso = {
	objetivo: () => document.querySelector('[data-tour-contacto]'),
	texto: 'Want to reach me? Use this',
	// Las dos líneas del final: el aviso dice que uses eso, así que taparlo es
	// lo único que no puede hacer.
	evitar: () => document.querySelectorAll('[data-tour-final]'),
};

/**
 * Lo que no se tapa en ninguna parada, lo esté señalando quien lo esté: el
 * nombre y el apodo. Es lo primero que se lee de la página, y una mano encima
 * de "Hi! I'm Juan David" no hay parada que lo justifique.
 */
const INTOCABLE = '[data-tour-nombre]';

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

/**
 * Todos los renglones de un elemento, uno a uno.
 *
 * Por caja de párrafo no vale: "You can find me on GitHub, or reach me via" y
 * "email." son dos renglones de la misma caja, y protegiendo solo la caja no
 * hay forma de decir que la mano no puede sentarse justo encima del segundo.
 */
function renglonesDe(el: Element): DOMRect[] {
	if (!el.textContent?.trim()) return [el.getBoundingClientRect()];
	const rango = document.createRange();
	rango.selectNodeContents(el);
	const rs = [...rango.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
	return rs.length ? rs : [el.getBoundingClientRect()];
}

/**
 * La caja de lo que se ve, que no es la del elemento.
 *
 * Un h2 ocupa el ancho entero de la columna, pero la palabra "Work" son
 * cuarenta píxeles a la izquierda: apuntando al centro de la caja, la mano
 * acaba señalando un sitio vacío a medio renglón de distancia del texto.
 *
 * De todos los renglones se coge el más grande y no la unión de todos, porque
 * la unión de dos líneas vuelve a ser un rectángulo con huecos: el final de la
 * primera y el principio de la segunda no tienen nada.
 */
function cajaVisible(el: Element): DOMRect {
	const caja = el.getBoundingClientRect();
	if (!el.textContent?.trim()) return caja;

	const rango = document.createRange();
	rango.selectNodeContents(el);
	const renglones = [...rango.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
	if (!renglones.length) return caja;
	return renglones.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
}

/**
 * Si en ese punto de la pantalla hay letras debajo.
 *
 * elementFromPoint devuelve el elemento más hondo que contiene el punto, y eso
 * no basta: el punto puede caer en la mitad vacía de un h1 que solo tiene texto
 * a la izquierda. Por eso además se comprueba contra los renglones de verdad.
 */
function hayTextoEn(x: number, y: number): boolean {
	const el = document.elementFromPoint(x, y);
	if (!el || !el.textContent?.trim()) return false;
	const rango = document.createRange();
	rango.selectNodeContents(el);
	return [...rango.getClientRects()].some(
		(r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom,
	);
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

	// tour=1 la fuerza entera aunque ya se haya visto, que si no no hay manera
	// de volver a verla sin borrar el almacenamiento a mano.
	const forzada = new URLSearchParams(location.search).get('tour') === '1';
	if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

	const mano = capa.querySelector<HTMLElement>('.mano');
	const dicho = capa.querySelector<HTMLElement>('.dicho');
	if (!mano || !dicho) return;
	capa.dataset.tourBound = '';

	/**
	 * El guion principal, y se renueva en cada pasada: la visita ya no se cuenta
	 * una vez y se acabó, se puede volver a contar.
	 */
	let corte = new AbortController();
	/**
	 * El aviso de contacto, que sobrevive al guion y se renueva con él: cada
	 * pasada acaba armando el suyo y cancelando el que quedara a medias.
	 */
	let corteFinal = new AbortController();
	/**
	 * Cada pasada lleva su propia señal y se mira la suya, no una bandera
	 * compartida. Con una bandera, la pasada nueva la ponía a false y la vieja,
	 * que seguía dormida en un await, despertaba creyéndose viva y se ponía a
	 * mover la mano encima de la que acababa de empezar.
	 */
	/** El ángulo al que está la mano ahora, para poder ir girando hasta el nuevo. */
	let giroActual = 0;

	const mostrar = (): void => {
		capa.hidden = false;
		delete capa.dataset.fuera;
	};
	/**
	 * Lo que la mano tiene delante y dónde estaba al ponerla.
	 *
	 * La mano se coloca en coordenadas de la página y ahí se queda, así que si la
	 * página crece debajo acaba señalando un sitio en vez de una cosa: con el
	 * aviso del café puesto, abrir un details mete otro contenido bajo el dedo.
	 * Guardando dónde estaba la diana se puede correr la mano lo mismo que se ha
	 * corrido ella.
	 */
	let seguimiento: { objetivo: Element; x: number; y: number } | null = null;

	/** De coordenadas de ventana a las de la capa, que son las de la página.
	 *  Restando su caja en vez de sumando scrollY, que en iOS no es de fiar. */
	const enLaCapa = (el: Element): { x: number; y: number } => {
		const r = el.getBoundingClientRect();
		const c = capa.getBoundingClientRect();
		return { x: r.left - c.left, y: r.top - c.top };
	};

	/*
		Correr la mano y el globo lo mismo que se haya corrido la diana.

		Se corren y no se vuelven a colocar: colocar elige el ángulo barriendo el
		círculo con un desfase aleatorio, así que rehacerlo en cada aviso del
		observador sacaría un ángulo distinto cada vez y la mano daría tirones.
		Corriéndola, el ángulo es el mismo y lo único que cambia es dónde está.
	*/
	const seguir = (): void => {
		if (!seguimiento || capa.hidden) return;
		ajustarCapa();
		const ahora = enLaCapa(seguimiento.objetivo);
		const dx = ahora.x - seguimiento.x;
		const dy = ahora.y - seguimiento.y;
		if (dx === 0 && dy === 0) return;
		seguimiento.x = ahora.x;
		seguimiento.y = ahora.y;
		for (const el of [mano, dicho]) {
			const p = donde(el);
			el.style.setProperty('--x', `${p.x + dx}px`);
			el.style.setProperty('--y', `${p.y + dy}px`);
		}
	};

	// De que la página cambie de alto no avisa ni un scroll ni un resize: abrir
	// un details o desplegar un (more) la alarga sin que salte ninguno.
	new ResizeObserver(seguir).observe(document.body);

	const esconder = (): void => {
		seguimiento = null;
		capa.dataset.fuera = '';
		// Se quita del DOM cuando acaba de desvanecerse, no antes.
		setTimeout(() => {
			capa.hidden = true;
		}, 350);
	};

	/*
		La capa cubre el documento entero, así que hay que darle ese alto. Se mide
		con ella a cero porque cuenta para él: si no se quita de en medio se mide a
		sí misma y solo puede crecer.
	*/
	const ajustarCapa = (): void => {
		capa.style.height = '0px';
		capa.style.height = `${document.documentElement.scrollHeight}px`;
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
		punta: { x: number; y: number },
		intocables: DOMRect[],
		vetados: DOMRect[],
	) => {
		const centroX = caja.left + caja.width / 2;
		const centroY = caja.top + caja.height / 2;

		// Hacia dónde apunta el dedo sin girar: hacia arriba, y punto. No es la
		// dirección de la punta, que va torcida por estar el dedo descentrado.
		const anguloIcono = -Math.PI / 2;

		const disponer = (grados: number) => {
			const rad = (grados * Math.PI) / 180;
			const ux = Math.cos(rad);
			const uy = Math.sin(rad);

			/*
				Primero dónde tiene que caer la punta, que es lo que de verdad señala:
				en el centro de lo que se ve, o justo fuera de su borde.
			*/
			const fuera = alCentro ? 0 : alBorde(caja.width, caja.height, ux, uy) + HUECO;
			const puntaX = centroX + ux * fuera;
			const puntaY = centroY + uy * fuera;

			/*
				El giro es el que lleva la dirección del icono a mirar al objetivo. La
				de vuelta al centro desde donde está la mano es (-ux, -uy).
			*/
			const giroRad = Math.atan2(-uy, -ux) - anguloIcono;
			const giro = (giroRad * 180) / Math.PI;

			// Y de la punta se retrocede al centro de la mano, girando el mismo
			// desplazamiento que separa a las dos dentro del icono.
			const cos = Math.cos(giroRad);
			const sen = Math.sin(giroRad);
			const manoX = puntaX - (punta.x * cos - punta.y * sen) * lado;
			const manoY = puntaY - (punta.x * sen + punta.y * cos) * lado;

			/*
				El globo sale por donde ha venido la mano, y alineado con ella en el
				eje del rabo.

				Antes se ponía en diagonal, a lo largo de la dirección de acercamiento,
				y luego se le pedía al rabo que apuntara. Con un bocadillo de veinte
				píxeles de alto eso solo cuadra si la mano está casi exactamente a su
				altura: bastaban diez grados de inclinación para que el rabo se saliera
				de su tramo y el ángulo hubiera que descartarlo. La ventana buena era
				de tres grados, y el barrido la fallaba la mitad de las veces.

				Alineado, el rabo apunta por construcción y lo único que puede
				desviarlo es el recorte contra un canto de la pantalla.
			*/
			const radioMano = (lado / 2) * (Math.abs(cos) + Math.abs(sen));
			/*
				Por un lado o por arriba, según hacia dónde tire más la dirección
				medida en semilados del globo: uno largo y bajo se sale por los lados
				mucho antes que por arriba, así que casi todo lo que no sea horizontal
				del todo acaba yendo arriba o abajo.
			*/
			const deLado = Math.abs(ux) / (anchoGlobo / 2) > Math.abs(uy) / (altoGlobo / 2);
			const dentro = (v: number, min: number, max: number): number =>
				Math.min(Math.max(v, min), max);

			let idealX: number;
			let idealY: number;
			if (deLado) {
				const lejos = radioMano + HUECO_GLOBO + anchoGlobo / 2;
				idealX = manoX + Math.sign(ux) * lejos;
				idealY = manoY;
			} else {
				const lejos = radioMano + HUECO_GLOBO + altoGlobo / 2;
				idealX = manoX;
				idealY = manoY + (uy >= 0 ? lejos : -lejos);
			}
			const globoCX = dentro(idealX, 8 + anchoGlobo / 2, window.innerWidth - 8 - anchoGlobo / 2);
			const globoCY = dentro(idealY, 8 + altoGlobo / 2, window.innerHeight - 8 - altoGlobo / 2);
			const globo = { x: globoCX - anchoGlobo / 2, y: globoCY - altoGlobo / 2 };

			// El rabo sale por el lado que mira a la mano.
			const rabo = deLado ? (ux > 0 ? 'izquierda' : 'derecha') : uy >= 0 ? 'arriba' : 'abajo';
			// Y a qué altura de ese lado, recortado para que no se meta en la
			// esquina redondeada.
			const largoLado = deLado ? altoGlobo : anchoGlobo;
			const suelto = deLado ? manoY - globo.y : manoX - globo.x;
			// El rabo no puede meterse en la esquina redondeada, así que se recorta.
			// Lo que se recorta es lo que deja de apuntar a la mano.
			const recortado = dentro(suelto, 10, largoLado - 10);

			return {
				sitio: { x: manoX - lado / 2, y: manoY - lado / 2 },
				globo,
				centro: { x: manoX, y: manoY },
				// Girada, la mano ocupa esta caja y no la suya: hace falta para
				// comprobar que el globo no se le echa encima.
				cajaMano: {
					left: manoX - radioMano,
					top: manoY - radioMano,
					right: manoX + radioMano,
					bottom: manoY + radioMano,
				},
				giro,
				rabo,
				desplazamientoRabo: recortado,
				/*
					Lo que el rabo acaba desviado de la mano. Pasa cuando el globo se
					recorta contra un canto de la pantalla: se desplaza, la mano se le
					queda fuera del tramo donde el rabo puede ir, y el rabo termina
					apuntando a una esquina vacía en vez de a ella.
				*/
				desvioRabo: Math.abs(suelto - recortado),
			};
		};

		const chocan = (
			a: { left: number; top: number; right: number; bottom: number },
			b: { left: number; top: number; right: number; bottom: number },
		): boolean => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

		/*
			Una sola nota por ángulo, con las penas ordenadas por lo mal que se ven.
			Cero es perfecto y se coge al momento; si ninguno da cero, el más bajo.

			Antes esto eran dos filtros y dos rescates encadenados, y con eso no hay
			forma de decir qué es peor que qué: la mano encima de "email" salía
			igualmente porque solo sumaba un punto, lo mismo que un globo rozando una
			palabra cualquiera.

			Lo único que descarta de plano es que la mano no quepa en pantalla. Todo
			lo demás es feo, no imposible, y siempre es mejor lo menos feo que
			rendirse al ángulo de abajo.
		*/
		const CASTIGO = {
			/*
				Los dos primeros no son feos, son rotos, y valen lo mismo: un rabo que
				apunta al aire y un puntero enterrado debajo de su propio bocadillo.

				El del globo encima de la mano pasó de veinte a cien por un motivo
				concreto. Acercándose por arriba a algo pegado al techo de la pantalla,
				el globo se sale, el recorte lo baja encima de la mano, y como el rabo
				de un globo así va en horizontal el recorte vertical no lo desvía: el
				ángulo salía con veinte de pena y le ganaba a otros mejores.
			*/
			raboTorcido: 100,
			globoSobreLaMano: 100,
			// El nombre va con ellos y no con lo demás: taparlo se ha pedido dos
			// veces, así que no puede perder contra una lista de este paso.
			sobreLoIntocable: 100,
			manoSobreLoVetado: 40,
			globoSobreLaDiana: 30,
			globoSobreLoVetado: 15,
		};

		const nota = (d: ReturnType<typeof disponer>): number => {
			const globo = {
				left: d.globo.x,
				top: d.globo.y,
				right: d.globo.x + anchoGlobo,
				bottom: d.globo.y + altoGlobo,
			};
			let mal = 0;
			if (d.desvioRabo > DESVIO_RABO_MAX) mal += CASTIGO.raboTorcido;
			if (intocables.some((v) => chocan(d.cajaMano, v) || chocan(globo, v)))
				mal += CASTIGO.sobreLoIntocable;
			if (vetados.some((v) => chocan(d.cajaMano, v))) mal += CASTIGO.manoSobreLoVetado;
			if (chocan(globo, d.cajaMano)) mal += CASTIGO.globoSobreLaMano;
			if (chocan(globo, caja)) mal += CASTIGO.globoSobreLaDiana;
			if (vetados.some((v) => chocan(globo, v))) mal += CASTIGO.globoSobreLoVetado;
			// Y por último, tapar letras sueltas: un punto por cada uno de los cinco
			// puntos que se miran del renglón central del globo. Con el centro solo
			// no basta, que un globo largo puede tener el medio en un hueco entre dos
			// palabras y las puntas encima del texto.
			const y = d.globo.y + altoGlobo / 2;
			mal += [0.1, 0.3, 0.5, 0.7, 0.9].filter((f) =>
				hayTextoEn(d.globo.x + anchoGlobo * f, y),
			).length;
			return mal;
		};

		const enPantalla = (d: ReturnType<typeof disponer>): boolean =>
			d.cajaMano.left >= 4 &&
			d.cajaMano.right <= window.innerWidth - 4 &&
			d.cajaMano.top >= 4 &&
			d.cajaMano.bottom <= window.innerHeight - 4;

		// El barrido entero, con el arranque movido al azar para que dos paradas
		// seguidas no prueben los mismos grados, y barajado para que entre dos
		// ángulos igual de buenos no gane siempre el mismo.
		const angulos: number[] = [];
		for (let a = Math.random() * PASO_ANGULO; a < 360; a += PASO_ANGULO) angulos.push(a);
		for (let i = angulos.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[angulos[i], angulos[j]] = [angulos[j], angulos[i]];
		}

		let mejor: ReturnType<typeof disponer> | null = null;
		let mejorNota = Infinity;
		for (const grados of angulos) {
			const salida = disponer(grados);
			if (!enPantalla(salida)) continue;
			const mal = nota(salida);
			if (mal === 0) return salida;
			if (mal < mejorNota) {
				mejorNota = mal;
				mejor = salida;
			}
		}
		return mejor ?? disponer(90);
	};

	const colocar = (objetivo: Element, paso: Paso, conViaje: boolean): void => {
		/*
			Lo primero, y no después de medir: ajustar la capa la pone a cero un
			instante para medir el documento sin ella, y si la capa era lo más alto
			de la página eso recorta el scroll máximo y el navegador mueve la página.
			Midiendo las dianas antes, esas medidas se quedarían viejas.
		*/
		ajustarCapa();

		const gesto = paso.gesto ?? 'apunta';
		mano.dataset.gesto = gesto;
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

		const caja = cajaVisible(objetivo);
		/*
			Dos listas y no una, porque no pesan igual: el nombre no se tapa nunca, y
			lo que declare el paso se evita si se puede.

			De las dos sale el renglón donde vive la propia diana: la mano tiene que
			ponerse a su lado por narices, así que contarlo como tapado sería
			penalizar todos los ángulos por igual y dejar la cuenta sin decir nada.
		*/
		const fuera = (r: DOMRect): boolean =>
			!(r.left < caja.right && caja.left < r.right && r.top < caja.bottom && caja.top < r.bottom);
		const intocables = [...document.querySelectorAll(INTOCABLE)].flatMap(renglonesDe).filter(fuera);
		const vetados = [...(paso.evitar?.() ?? [])].flatMap(renglonesDe).filter(fuera);
		const puesto = acercarse(
			caja,
			paso.alCentro === true,
			lado,
			anchoGlobo,
			altoGlobo,
			PUNTA[gesto],
			intocables,
			vetados,
		);
		giroActual = puesto.giro;

		/*
			Todo el cálculo va en coordenadas de ventana, que es lo que devuelven los
			rectángulos y lo que entienden elementFromPoint y el recorte contra los
			cantos. Al escribirlo se pasa a las del documento, que son las de la
			capa, y con eso la mano deja de necesitar que nadie la mueva al bajar.
		*/
		const scroll = window.scrollY;
		const destinoMano = { x: puesto.sitio.x, y: puesto.sitio.y + scroll };
		const destinoGlobo = { x: puesto.globo.x, y: puesto.globo.y + scroll };

		for (const [el, destino] of [
			[mano, destinoMano],
			[dicho, destinoGlobo],
		] as const) {
			el.style.setProperty('--x', `${destino.x}px`);
			el.style.setProperty('--y', `${destino.y}px`);
		}
		mano.style.setProperty('--giro', `${puesto.giro}deg`);
		dicho.dataset.rabo = puesto.rabo;
		dicho.style.setProperty('--rabo', `${puesto.desplazamientoRabo}px`);

		// Antes del return de abajo: con viaje o sin él, la mano ya sabe a qué se
		// ha puesto delante, y a partir de aquí lo sigue si la página lo mueve.
		seguimiento = { objetivo, ...enLaCapa(objetivo) };

		if (!conViaje) return;
		viajar(mano, antesMano, destinoMano, giroAnterior, puesto.giro);
		// El bocadillo no se ladea ni gira: torcido no es inercia, es un fallo.
		viajar(dicho, antesGlobo, destinoGlobo, 0, 0);
	};

	/** El toque o el tirón, según la mano que toque. */
	const gesticular = (): void => {
		// Quitar el atributo no basta si se vuelve a poner en el mismo fotograma:
		// hay que forzar un reflujo entre medias para que el navegador se entere
		// de que es otra animación y no la misma siguiendo.
		delete mano.dataset.toca;
		void mano.offsetWidth;
		mano.dataset.toca = '';
		// Un sonido por gesto, y distintos: señalar y arrastrar no son lo mismo.
		sound.play(mano.dataset.gesto === 'agarra' ? 'drag' : 'point');
		empujarDiana();
	};

	/**
	 * Lo que se mueve el puño a cada lado, en píxeles. El mismo número está en
	 * los fotogramas de Tour.astro, que es de donde sale.
	 */
	const TIRON = 6;

	/**
	 * La pegatina se va con la mano.
	 *
	 * Enseñar que algo se arrastra moviendo la mano encima y dejando la cosa
	 * quieta no enseña nada: parece que la mano pasa por delante. Se mueven las
	 * dos y ya se lee lo que es.
	 *
	 * El puño se desplaza a lo largo de su propio eje, y la mano puede estar
	 * girada a cualquier ángulo, así que lo que para ella es "a un lado y al
	 * otro" en la página es una diagonal cualquiera. De ahí que la dirección se
	 * calcule del giro y se le pase a la pegatina en vez de estar escrita en la
	 * hoja de estilos.
	 *
	 * Y el reflujo de en medio, por lo mismo que en el gesto: sin él, volver a
	 * poner el atributo en el mismo fotograma no reinicia la animación.
	 */
	const empujarDiana = (): void => {
		const diana = seguimiento?.objetivo;
		if (mano.dataset.gesto !== 'agarra' || !(diana instanceof HTMLElement)) return;
		const rad = (giroActual * Math.PI) / 180;
		diana.style.setProperty('--ex', `${(Math.cos(rad) * TIRON).toFixed(2)}px`);
		diana.style.setProperty('--ey', `${(Math.sin(rad) * TIRON).toFixed(2)}px`);
		delete diana.dataset.empujada;
		void diana.offsetWidth;
		diana.dataset.empujada = '';
	};

	/*
		El aviso de cómo dar con él. Va aparte del guion porque contesta a otra
		cosa: los demás enseñan qué mirar, y este aparece cuando ya has mirado.

		Lo dispara tener el enlace a la vista, no el gesto de bajar. Pedía un
		evento de scroll y eso lo dejaba muerto en una pantalla alta, donde la
		página entra entera y no hay scroll que capturar: justo donde el usuario
		ya está viendo el final sin haber hecho nada.

		Con un respiro antes, para que se lea como algo aparte y no como el paso
		siguiente pegado al anterior.
	*/
	const armarContacto = (): void => {
		/*
			Uno por pasada, no uno por carga.

			Se arma al acabar el guion, y el guion se puede contar varias veces. Con
			uno por carga, repetir la visita desde la foto se quedaba sin final:
			el aviso ya se había gastado en la primera.

			Y el que quedara a medias se cancela, que si no se acumulan observadores
			de una pasada que ya no existe. La señal se guarda aquí y no se lee de
			corteFinal cada vez, porque para cuando esto despierte puede haber otra.
		*/
		corteFinal.abort();
		corteFinal = new AbortController();
		const señal = corteFinal.signal;

		const objetivo = CONTACTO.objetivo();
		if (!(objetivo instanceof Element)) return;

		const mirar = new IntersectionObserver(
			(entradas) => {
				if (!entradas.some((e) => e.isIntersecting)) return;
				mirar.disconnect();
				void (async () => {
					await dormir(RESPIRO);
					if (señal.aborted) return;
					// En ese respiro da tiempo de sobra a subir otra vez. Si el enlace
					// ya no está delante, a la cola como cualquier otra parada.
					await cuandoSeVea(objetivo, señal);
					if (señal.aborted) return;
					mostrar();
					colocar(objetivo, CONTACTO, false);
					gesticular();
					await dormir(PARADA_FINAL);
					esconder();
				})();
			},
			{ threshold: 0.9 },
		);
		mirar.observe(objetivo);
		señal.addEventListener('abort', () => mirar.disconnect());
	};

	/** Corta lo que se esté contando, sin darlo por terminado. */
	const cortar = (): void => corte.abort();

	/** Lo da por terminado: se va la mano y queda armado el aviso del final. */
	const parar = (): void => {
		if (corte.signal.aborted) return;
		cortar();
		esconder();
		armarContacto();
	};

	/*
		Se va con el teclado, pero ni con un clic ni con el scroll.

		Con el clic no, porque la visita espera justo eso, que pulses el botón de
		sonido: cortarla ahí sería matarla en el momento de hacerle caso.

		Y con el scroll tampoco. Cortaba, y cortar es lo que arma el aviso final,
		así que bajar a mitad de visita se saltaba todo lo que quedaba y soltaba el
		último de golpe. Las paradas que faltan siguen siendo lo que hay que
		contar, y el final va al final.
	*/
	// La escucha va dentro de contar(), que es quien estrena corte en cada pasada.

	/**
	 * Si está entera dentro de la ventana. Entera y no a medias: una diana
	 * cortada por un canto se señala igual de mal que una que no está.
	 */
	const aLaVista = (el: Element): boolean => {
		const r = el.getBoundingClientRect();
		return (
			r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth
		);
	};

	/**
	 * Espera a que la diana vuelva a estar a la vista.
	 *
	 * Se mira en cada scroll y no con un observador de intersección, porque lo
	 * que importa no es cruzar un umbral una vez: es el estado en el momento de
	 * enseñar la mano. El observador avisa al cruzar, y entre el aviso y el
	 * momento de pintar cabe de sobra un scroll de vuelta.
	 */
	const cuandoSeVea = (objetivo: Element, señal: AbortSignal): Promise<void> =>
		new Promise((listo) => {
			if (aLaVista(objetivo) || señal.aborted) {
				listo();
				return;
			}
			const revisar = (): void => {
				if (!aLaVista(objetivo) && !señal.aborted) return;
				window.removeEventListener('scroll', revisar);
				window.removeEventListener('resize', revisar);
				señal.removeEventListener('abort', revisar);
				listo();
			};
			/*
				La señal va por parámetro y la limpieza a mano, en vez de pasársela a
				addEventListener. El aviso de contacto llega cuando el guion ya ha
				terminado y su controlador está abortado, y registrar una escucha con
				una señal ya abortada no registra nada: se quedaba esperando para
				siempre a un scroll que nunca le llegaba.
			*/
			window.addEventListener('scroll', revisar, { passive: true });
			window.addEventListener('resize', revisar, { passive: true });
			señal.addEventListener('abort', revisar);
		});

	let primera = true;

	/** Lleva la mano a un sitio y la deja ahí. Devuelve si sigue viva la visita. */
	const parada = async (paso: Paso, quedarse: number, señal: AbortSignal): Promise<boolean> => {
		const objetivo = paso.objetivo();
		if (!(objetivo instanceof Element)) return !señal.aborted;

		/*
			Si lo que toca señalar no está a la vista, la parada se pone en cola: se
			esconde la mano y se espera. Salir igualmente es señalar a un sitio de la
			pantalla donde ya no hay nada, o directamente fuera de ella.

			Y al volver aparece puesta, sin viaje: no viene de ningún sitio, porque
			mientras esperaba no estaba en ninguno.
		*/
		if (!aLaVista(objetivo)) {
			esconder();
			await cuandoSeVea(objetivo, señal);
			if (señal.aborted) return false;
			mostrar();
			primera = true;
		}

		// El primer sitio se pone y ya: no hay de dónde venir.
		colocar(objetivo, paso, !primera);
		if (primera) {
			primera = false;
		} else {
			await dormir(VIAJE);
			if (señal.aborted) return false;
		}
		// El gesto, al llegar. Haciéndolo al salir, la mano señalaba en el aire.
		gesticular();
		await dormir(quedarse);
		return !señal.aborted;
	};

	/** Resuelve en cuanto el sonido se enciende, o a false si se acaba el tiempo. */
	const esperarSonido = (señal: AbortSignal): Promise<boolean> =>
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
			señal.addEventListener('abort', () => rendirse(false));
		});

	/*
		El guion entero, en orden.

		El orden es el de una presentación: dónde se enciende el sonido, quién
		soy, dónde he trabajado, qué he hecho, y con qué. Las pegatinas al final
		porque son lo único que pide hacer algo, y eso se deja para cuando ya se
		ha contado lo demás.
	*/
	// El orden es el de la página, con las pegatinas al final porque son lo
	// único que pide hacer algo.
	const RESTO: readonly Paso[] = [TRABAJO, PROYECTOS, BLOG, PEGATINA];

	/**
	 * El guion de esta pasada.
	 *
	 * El del sonido solo si está apagado, que si ya viene puesto pedirlo sobra. Y
	 * detrás la foto siempre, lo encienda o no: aquel paso pide algo y este
	 * presenta, y presentarse toca igual.
	 *
	 * El resto solo la primera vez. Después el saludo se queda corto a propósito:
	 * quien ya lo ha visto no tiene por qué verlo entero en cada visita, y para
	 * eso está la foto, que lo repite a demanda.
	 */
	const guionDe = (entero: boolean): Paso[] => [
		...(sound.isMuted() ? [SONIDO] : []),
		entero ? FOTO : FOTO_OTRA_VEZ,
		...(entero ? RESTO : []),
	];

	/**
	 * Cuenta la visita.
	 *
	 * Lo que se pida manda sobre lo que se esté viendo: contar corta lo anterior
	 * y empieza. Antes era al revés y se ignoraba la petición si había algo en
	 * pantalla, que además de raro era un contrasentido: lo que había en pantalla
	 * podía ser justo el globo diciendo que pulses la foto, y pulsarla no hacía
	 * nada hasta que ese globo se fuera solo.
	 *
	 * Cada pasada estrena corte y se queda con su señal. El de la anterior quedó
	 * abortado y con él sus esperas, así que reusarlo sería arrancar muerto; y
	 * mirar la suya, y no una bandera común, es lo que impide que la pasada vieja
	 * despierte de un await creyéndose viva.
	 */
	const contar = async (pasos: readonly Paso[]): Promise<void> => {
		if (!pasos.length) return;
		cortar();
		// El aviso final de la pasada anterior no puede saltar en mitad de esta.
		corteFinal.abort();
		corte = new AbortController();
		const señal = corte.signal;
		primera = true;
		window.addEventListener('keydown', parar, { signal: señal, passive: true });

		mostrar();
		for (const [i, paso] of pasos.entries()) {
			if (paso === SONIDO) {
				// Sin espera propia: lo que la mantiene ahí eres tú. Y lo enciendas
				// o no, después viene la foto igual.
				if (!(await parada(paso, 0, señal))) return;
				await esperarSonido(señal);
				if (señal.aborted) return;
				continue;
			}
			const ultima = i === pasos.length - 1;
			if (!(await parada(paso, paso.espera ?? (ultima ? PARADA_FINAL : PARADA), señal))) return;
		}
		if (señal.aborted) return;
		parar();
	};

	void (async () => {
		await dormir(ARRANQUE);
		const entero = forzada || !yaVisto();
		// Se apunta al empezar y no al acabar: recargar a mitad no la repite.
		if (entero) apuntarVisto();
		await contar(guionDe(entero));
	})();

	/*
		Y volver a verla entera es cosa de pulsar la foto, solo de eso.

		Es el único sitio de la página que no hacía nada al pulsarlo, y es la que
		da la cara: el mando natural para "cuéntamelo otra vez".
	*/
	const avatar = root.querySelector<HTMLElement>('[data-tour-avatar]');
	avatar?.addEventListener('click', () => void contar(guionDe(true)));
}
