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

/** Intentos de ángulo antes de rendirse al de toda la vida, el de abajo. Son
 *  unas cuantas condiciones, y descartar sale barato. */
const INTENTOS = 24;
/** Lo que separa la punta del dedo del borde de lo que señala. */
const HUECO = 6;

/**
 * Dónde tiene la punta cada mano, en partes de su lado y desde su centro.
 *
 * Medido rasterizando los dos iconos y buscando el píxel más alto: en una caja
 * de 64, el dedo de hand-pointer acaba en (26,5 · 6) y no en (32 · 6). O sea
 * que la punta está corrida a la izquierda y el dedo sale doce grados torcido
 * de lo que uno supondría. Dando por hecho que apunta recto hacia arriba, la
 * mano se coloca bien pero mira siempre un poco de lado.
 *
 * El puño sí está centrado, pero se mide igual: la cuenta es la misma y así no
 * hay dos caminos.
 */
const PUNTA = {
	apunta: { x: -0.086, y: -0.406 },
	agarra: { x: 0.008, y: -0.406 },
} as const;
/** Lo que separa el bocadillo de la mano. */
const HUECO_GLOBO = 8;
/** Lo que puede alejarse el globo de su sitio al recortarlo contra el canto de
 *  la pantalla antes de que el rabo deje de apuntar a la mano. */
const ARRASTRE_MAX = 26;
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
	/*
		El nombre del primer puesto, no el rótulo "Work" ni la fila entera.

		Con la fila, el renglón más ancho va del nombre a la fecha y su centro cae
		justo en la fecha: la mano acababa señalando "2024 - Present". Lo que
		identifica el puesto es el nombre.
	*/
	objetivo: () => document.querySelector('[data-tour-work] [data-entry-name]'),
	texto: 'Where I’ve worked',
	// El bloque entero: se señala uno, pero se habla de todos.
	evitar: () => document.querySelectorAll('[data-tour-work]'),
};

const PROYECTOS: Paso = {
	objetivo: () => document.querySelector('[data-tour-proyectos] [data-entry-name]'),
	texto: 'And what I’ve built on my own',
	evitar: () => document.querySelectorAll('[data-tour-proyectos]'),
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
	/** Qué se está señalando y desde qué ángulo, para repetirlo al hacer scroll. */
	let señalando: { objetivo: Element; paso: Paso; grados: number } | null = null;

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
		punta: { x: number; y: number },
		vetados: DOMRect[],
		/** Un ángulo ya elegido, para repetir la misma colocación al hacer scroll. */
		forzado: number | undefined,
	) => {
		const centroX = caja.left + caja.width / 2;
		const centroY = caja.top + caja.height / 2;

		// Hacia dónde apunta la mano sin girar, de su centro a su punta.
		const anguloIcono = Math.atan2(punta.y, punta.x);

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
				El globo sale por donde ha venido la mano, siguiendo la misma
				dirección: por la derecha si vino por la derecha, por arriba si vino
				por arriba. Así nunca queda entre la mano y lo que está señalando, que
				es lo único que no puede pasar.
			*/
			const radioMano = (lado / 2) * (Math.abs(cos) + Math.abs(sen));
			const salida = radioMano + HUECO_GLOBO + alBorde(anchoGlobo, altoGlobo, ux, uy);
			const dentro = (v: number, min: number, max: number): number =>
				Math.min(Math.max(v, min), max);
			const idealX = manoX + ux * salida;
			const idealY = manoY + uy * salida;
			const globoCX = dentro(idealX, 8 + anchoGlobo / 2, window.innerWidth - 8 - anchoGlobo / 2);
			const globoCY = dentro(idealY, 8 + altoGlobo / 2, window.innerHeight - 8 - altoGlobo / 2);
			const globo = { x: globoCX - anchoGlobo / 2, y: globoCY - altoGlobo / 2 };

			/*
				El rabo sale por el lado del globo que mira a la mano. Cuál es se
				decide comparando lo que sobresale por cada eje en partes del semilado,
				no en píxeles: un globo largo y bajo se sale por los lados mucho antes
				que por arriba.
			*/
			const haciaX = manoX - globoCX;
			const haciaY = manoY - globoCY;
			const deLado = Math.abs(haciaX) / (anchoGlobo / 2) > Math.abs(haciaY) / (altoGlobo / 2);
			const rabo = deLado
				? haciaX > 0
					? 'derecha'
					: 'izquierda'
				: haciaY > 0
					? 'abajo'
					: 'arriba';
			// Y a qué altura de ese lado, recortado para que no se meta en la
			// esquina redondeada.
			const largoLado = deLado ? altoGlobo : anchoGlobo;
			const suelto = deLado ? manoY - globo.y : manoX - globo.x;

			return {
				grados,
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
				desplazamientoRabo: dentro(suelto, 10, largoLado - 10),
				/*
					Cuánto lo ha movido el recorte contra el canto de la pantalla. Es
					eso y no si el rabo cae en el tramo bueno del globo: con un globo de
					veinte píxeles de alto, un rabo lateral solo cabe centrado, así que
					pedir que además apunte exacto descartaba casi todos los ángulos de
					lado y el bocadillo no salía nunca a los lados.
				*/
				arrastrado: Math.hypot(globoCX - idealX, globoCY - idealY),
			};
		};

		const chocan = (
			a: { left: number; top: number; right: number; bottom: number },
			b: { left: number; top: number; right: number; bottom: number },
		): boolean => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

		const cabe = (d: ReturnType<typeof disponer>): boolean => {
			const globo = {
				left: d.globo.x,
				top: d.globo.y,
				right: d.globo.x + anchoGlobo,
				bottom: d.globo.y + altoGlobo,
			};
			return (
				// La mano entera dentro de la pantalla.
				d.cajaMano.left >= 4 &&
				d.cajaMano.right <= window.innerWidth - 4 &&
				d.cajaMano.top >= 4 &&
				d.cajaMano.bottom <= window.innerHeight - 4 &&
				// El globo ya sale recortado dentro de la pantalla, pero ese recorte
				// puede haberlo empujado de vuelta encima de la mano.
				!chocan(globo, d.cajaMano) &&
				// Y encima de lo que se está señalando tampoco: tapar la foto justo
				// mientras se dice "ese soy yo" es lo peor que puede hacer.
				!chocan(globo, caja) &&
				// Y que el recorte no lo haya arrastrado tan lejos de la mano como
				// para que el rabo señale al aire.
				d.arrastrado < ARRASTRE_MAX
			);
		};

		/*
			De los que caben, mejor uno cuyo bocadillo no caiga encima de nada. El
			globo es opaco: puesto sobre el titular lo tapa entero mientras dura la
			parada, y ese es justo el sitio donde más molesta.

			Lo vetado pesa más que el texto suelto, porque son cosas de las que se
			está hablando ahora mismo. Del texto se miran cinco puntos del renglón
			central: con el centro solo no basta, que un globo largo puede tener el
			medio en un hueco entre dos palabras y las puntas encima de letras.
		*/
		const penalizar = (d: ReturnType<typeof disponer>): number => {
			const globo = {
				left: d.globo.x,
				top: d.globo.y,
				right: d.globo.x + anchoGlobo,
				bottom: d.globo.y + altoGlobo,
			};
			const y = d.globo.y + altoGlobo / 2;
			const letras = [0.1, 0.3, 0.5, 0.7, 0.9].filter((f) =>
				hayTextoEn(d.globo.x + anchoGlobo * f, y),
			).length;
			// La mano tapa tanto como el globo: es opaca, lleva contorno negro y
			// encima se mueve. Señalando "Let's grab a coffee" se sentaba encima de
			// "email", que es el renglón de abajo.
			const encima = vetados.filter(
				(v) => chocan(globo, v) || chocan(d.cajaMano, v),
			).length;
			return encima * 10 + letras;
		};

		/*
			Alrededor de algo pegado a una esquina puede no haber ni un solo ángulo
			que deje el globo sobre fondo limpio. Entonces no vale rendirse al
			primero que quepa: se coge el menos malo, que es la diferencia entre
			rozar una palabra y sentarse encima del titular entero.
		*/
		// Repitiendo una colocación no se sortea nada: se quiere exactamente la
		// misma, con lo que se ha movido el objetivo y nada más.
		if (forzado !== undefined) return disponer(forzado);

		let mejor: ReturnType<typeof disponer> | null = null;
		let mejorNota = Infinity;
		for (let i = 0; i < INTENTOS; i++) {
			const salida = disponer(Math.random() * 360);
			if (!cabe(salida)) continue;
			const nota = penalizar(salida);
			if (nota === 0) return salida;
			if (nota < mejorNota) {
				mejorNota = nota;
				mejor = salida;
			}
		}
		return mejor ?? disponer(90);
	};

	const colocar = (objetivo: Element, paso: Paso, conViaje: boolean, forzado?: number): void => {
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
		const vetados = [
			...document.querySelectorAll(INTOCABLE),
			...(paso.evitar?.() ?? []),
		].flatMap(renglonesDe);
		const puesto = acercarse(
			caja,
			paso.alCentro === true,
			lado,
			anchoGlobo,
			altoGlobo,
			PUNTA[gesto],
			vetados,
			forzado,
		);
		giroActual = puesto.giro;
		señalando = { objetivo, paso, grados: puesto.grados };

		for (const [el, destino] of [
			[mano, puesto.sitio],
			[dicho, puesto.globo],
		] as const) {
			el.style.setProperty('--x', `${destino.x}px`);
			el.style.setProperty('--y', `${destino.y}px`);
		}
		mano.style.setProperty('--giro', `${puesto.giro}deg`);
		dicho.dataset.rabo = puesto.rabo;
		dicho.style.setProperty('--rabo', `${puesto.desplazamientoRabo}px`);

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
		const objetivo = CONTACTO.objetivo();
		if (!(objetivo instanceof Element)) return;

		const mirar = new IntersectionObserver(
			(entradas) => {
				if (!entradas.some((e) => e.isIntersecting)) return;
				mirar.disconnect();
				void (async () => {
					await dormir(RESPIRO);
					if (corteFinal.signal.aborted) return;
					// En ese respiro da tiempo de sobra a subir otra vez. Si el enlace
					// ya no está delante, a la cola como cualquier otra parada.
					await cuandoSeVea(objetivo, corteFinal.signal);
					if (corteFinal.signal.aborted) return;
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
	};

	const parar = (): void => {
		if (cortada) return;
		cortada = true;
		señalando = null;
		corte.abort();
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
	window.addEventListener('keydown', parar, { signal: corte.signal, passive: true });

	/*
		Y si bajas, la mano baja contigo. La capa va fija a la ventana y lo que
		señala no, así que sin esto se quedaría clavada apuntando al sitio donde el
		objetivo estaba hace un momento. Se repite la misma colocación, con el
		mismo ángulo: solo cambia dónde está la diana.
	*/
	window.addEventListener(
		'scroll',
		() => {
			if (capa.hidden || !señalando) return;
			colocar(señalando.objetivo, señalando.paso, false, señalando.grados);
		},
		// Con corteFinal y no con corte: el aviso de contacto llega cuando el guion
		// ya ha terminado, y también tiene que seguir a su enlace. Sin esto, al
		// salir de la cola se colocaba con la medida del primer evento de scroll,
		// con la página todavía moviéndose, y se quedaba apuntando a media bajada.
		{ signal: corteFinal.signal, passive: true },
	);

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
	const parada = async (paso: Paso, quedarse: number): Promise<boolean> => {
		const objetivo = paso.objetivo();
		if (!(objetivo instanceof Element)) return !cortada;

		/*
			Si lo que toca señalar no está a la vista, la parada se pone en cola: se
			esconde la mano y se espera. Salir igualmente es señalar a un sitio de la
			pantalla donde ya no hay nada, o directamente fuera de ella.

			Y al volver aparece puesta, sin viaje: no viene de ningún sitio, porque
			mientras esperaba no estaba en ninguno.
		*/
		if (!aLaVista(objetivo)) {
			esconder();
			await cuandoSeVea(objetivo, corte.signal);
			if (cortada) return false;
			mostrar();
			primera = true;
		}

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
		if (!(await parada(PROYECTOS, PARADA))) return;
		parar();
	})();
}
