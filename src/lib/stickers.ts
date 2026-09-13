/**
 * Pegatinas con física por encima de la página.
 *
 * No caen: aparecen puestas. La gravedad solo sabe ir hacia abajo, así que el
 * borde de la ventana es el único sitio al que sabe llevarlas, y van
 * amontonadas en los márgenes del texto si la pantalla es ancha, o en un hueco
 * que la página les reserva si es estrecha. Para eso hay que ponerlas a mano.
 *
 * La simulación la lleva matter-js; el dibujo no. Cada pegatina sigue siendo un
 * elemento del DOM al que se le escribe el transform de su cuerpo en cada
 * fotograma, así el logo sigue siendo SVG nítido, el troquelado se hace con
 * CSS y no hay que pasar nada a mapa de bits.
 *
 * Los cuerpos son rectángulos y no círculos: un círculo no puede quedarse
 * inclinado, así que una pila de círculos se lee como una piscina de bolas. Un
 * rectángulo se apoya en un canto y queda torcido, que es como se amontonan las
 * pegatinas de verdad.
 *
 * Sin gravedad y sin colisiones entre ellas, las dos cosas por el mismo motivo:
 * una pegatina se queda donde la pegas. Si al soltarla se va no es una
 * pegatina, es un objeto cayendo; y si al poner una encima de otra la de debajo
 * sale empujada, tampoco: las pegatinas se superponen, no se apartan.
 *
 * Siguen chocando con las paredes, que es lo que impide perderlas fuera de la
 * página.
 */

import Matter from 'matter-js';

const PARED = 400;
/** Paredes y pegatinas en categorías distintas, para que las pegatinas puedan
 *  ignorarse entre ellas y seguir chocando con los bordes. */
const CAT_PARED = 0x0001;
const CAT_FICHA = 0x0002;

interface Ficha {
	el: HTMLElement;
	cuerpo: Matter.Body;
	mitadX: number;
	mitadY: number;
	/** Ángulo de reposo, fijo. El giro no lo decide la física. */
	base: number;
}

interface Instancia {
	fichas: Ficha[];
	paredes: Matter.Body[];
	ancho: number;
	alto: number;
}

interface Sitio {
	x: number;
	y: number;
}

function paredesDe(ancho: number, alto: number): Matter.Body[] {
	const opts = {
		isStatic: true,
		restitution: 0.1,
		friction: 0.6,
		collisionFilter: { category: CAT_PARED, mask: CAT_FICHA, group: 0 },
	};
	return [
		Matter.Bodies.rectangle(ancho / 2, alto + PARED / 2, ancho + PARED * 2, PARED, opts),
		Matter.Bodies.rectangle(-PARED / 2, alto / 2, PARED, alto * 6, opts),
		Matter.Bodies.rectangle(ancho + PARED / 2, alto / 2, PARED, alto * 6, opts),
		Matter.Bodies.rectangle(ancho / 2, -alto * 3, ancho + PARED * 2, PARED, opts),
	];
}

/** Inclinación máxima hacia el lado del movimiento, en radianes. */
const LADEO = 0.16;

function colocar(f: Ficha): void {
	const { x, y } = f.cuerpo.position;
	// Se ladea un poco hacia donde va y vuelve sola a su ángulo de reposo al
	// frenar, porque la velocidad tiende a cero. Es giro, pero acotado: nunca
	// pasa de unos grados, así que el logo se lee siempre del derecho.
	const ladeo = Math.max(-LADEO, Math.min(LADEO, f.cuerpo.velocity.x * 0.028));
	f.el.style.transform = `translate(${x - f.mitadX}px, ${y - f.mitadY}px) rotate(${f.base + ladeo}rad)`;
}

export function bindStickers(root: ParentNode = document): void {
	for (const capa of root.querySelectorAll<HTMLElement>('[data-stickers]')) {
		if (capa.dataset.stickersBound !== undefined) continue;
		capa.dataset.stickersBound = '';

		const elementos = [...capa.querySelectorAll<HTMLElement>('[data-sticker]')];
		if (!elementos.length) continue;

		let ancho = capa.clientWidth;
		let alto = capa.clientHeight;

		/**
		 * Lo que mide cada una sin escalar, leído antes de tocar nada. Si el tamaño
		 * de partida se lee del elemento cada vez, la segunda escala se aplica
		 * sobre el resultado de la primera y encogen sin parar.
		 */
		const ORIGINALES = elementos.map((el) => parseFloat(el.style.width));

		let anchos = ORIGINALES;
		let anchoMax = Math.max(...anchos);
		/** Si están ancladas a la página o al borde de la ventana. */
		let conLaPagina = false;

		/** Lo que se apartan del texto, y lo que se desvían del eje de su montón. */
		const SEP = 28;
		const VAIVEN = 20;
		/**
		 * Cuánto avanza el montón por pegatina, en partes de la más ancha. Menos
		 * de uno a propósito: así se solapan, que es lo que las hace un montón y
		 * no una fila.
		 */
		const SOLAPE = 0.62;

		/** Un montón en horizontal, centrado en el ancho de la página. */
		const tira = (centro: number): Sitio[] => {
			const paso = anchos.length > 1 ? (ancho - anchoMax - 8) / (anchos.length - 1) : 0;
			const inicio = (ancho - paso * (anchos.length - 1)) / 2;
			// Alternar la altura da el desorden de un montón hecho a mano.
			return anchos.map((_, i) => ({ x: inicio + paso * i, y: centro + ((i % 2) - 0.5) * 22 }));
		};

		/** Dos montones en vertical, uno por margen, apilados desde abajo. */
		const columnas = (texto: HTMLElement): Sitio[] => {
			const caja = texto.getBoundingClientRect();
			// Contra el texto y no contra la caja: el relleno de main son ochenta
			// píxeles y el montón quedaría descolgado del final de la página.
			const abajo = caja.bottom + window.scrollY - parseFloat(getComputedStyle(texto).paddingBottom);
			const ejes = [caja.left - SEP - anchoMax / 2, caja.right + SEP + anchoMax / 2];
			// Un lado y otro alternándose, para que los tamaños queden repartidos y
			// no acaben las grandes todas juntas.
			const lados = [0, 1].map((lado) => anchos.filter((_, i) => i % 2 === lado));
			const puestas = lados.map((col, lado) => {
				const mayor = Math.max(...col);
				return col.map((_, n) => ({
					// Sin este vaivén no parecen pegatinas puestas, parecen un menú.
					x: ejes[lado] + ((n % 2) - 0.5) * VAIVEN,
					// Del suelo hacia arriba: la última de la lista es la de abajo, y
					// como también es la última del DOM, queda encima. Que es el orden
					// en el que quedan si las vas dejando de una en una.
					y: abajo - mayor / 2 - mayor * SOLAPE * (col.length - 1 - n),
				}));
			});
			return anchos.map((_, i) => puestas[i % 2][(i / 2) | 0]);
		};

		/*
			Ancladas a la página, la capa deja de ir fija a la ventana y pasa a
			cubrir el documento entero. Si no, su sitio se iría con el scroll y las
			pegatinas se quedarían clavadas en la pantalla, encima del texto. Y
			puesta en el origen del documento, las coordenadas de matter y las del
			ratón ya son las de la página y no hay nada que corregir.

			El recorte es porque así cuenta para el alto del documento: una pegatina
			arrastrada más abajo del final lo alargaría.

			De ahí también lo de medir con la capa a cero: cuenta para lo que mide,
			así que si no se quita de en medio se mide a sí misma y solo puede crecer.
		*/
		const medirDocumento = (): number => {
			capa.style.height = '0px';
			const h = document.documentElement.scrollHeight;
			capa.style.height = `${h}px`;
			return h;
		};

		/**
		 * Tamaño y sitio de cada una para el ancho que haya ahora mismo. Se llama
		 * al empezar y en cada resize, así que no puede dar nada por hecho: vuelve
		 * a medir la ventana, el texto y el hueco, y devuelve el reparto entero.
		 *
		 * Dónde van no es lo mismo en todas partes. En una pantalla ancha sobra
		 * margen a los dos lados del texto, y ahí es donde no tapan nada. En una
		 * estrecha no sobra ninguno, así que la página les reserva un hueco entre la
		 * presentación y Work; ese hueco solo existe por debajo de sm, que es donde
		 * la hoja de estilos lo deja ver, y en escritorio mide cero. Y si no hay ni
		 * lo uno ni lo otro, al borde de abajo de la ventana, que es el único sitio
		 * que queda.
		 *
		 * El margen tiene que dar para una pegatina entera con su separación y su
		 * vaivén, o se saldría por el canto.
		 */
		const acomodar = (): Sitio[] => {
			ancho = capa.clientWidth;

			// En pantalla estrecha ocupan demasiado: diez de ~90px no caben en 375
			// sin comerse media pantalla. Por encima de 640 el factor es 1.
			const escala = ancho < 640 ? Math.max(0.56, ancho / 640) : 1;
			elementos.forEach((el, i) => {
				const lado = Math.round(ORIGINALES[i] * escala);
				el.style.width = `${lado}px`;
				el.style.height = `${lado}px`;
			});
			anchos = elementos.map((el) => el.offsetWidth);
			anchoMax = Math.max(...anchos);

			const cajaHueco = document
				.querySelector<HTMLElement>('[data-sticker-hueco]')
				?.getBoundingClientRect();
			const texto = document.querySelector<HTMLElement>('main');
			const cajaTexto = texto?.getBoundingClientRect();
			const margen = cajaTexto ? Math.min(cajaTexto.left, ancho - cajaTexto.right) : 0;

			const enHueco = cajaHueco !== undefined && cajaHueco.height > 0;
			const enMargenes =
				!enHueco && texto !== null && margen >= SEP + anchoMax + VAIVEN / 2 + 4;
			conLaPagina = enHueco || enMargenes;

			if (conLaPagina) {
				capa.style.position = 'absolute';
				capa.style.overflow = 'hidden';
				alto = medirDocumento();
			} else {
				// De vuelta a la ventana. Se quitan los tres estilos en lugar de
				// asignarles valores: así vuelve a mandar la hoja de estilos, que ya
				// la tiene fija y pegada a los cuatro bordes.
				capa.style.position = '';
				capa.style.overflow = '';
				capa.style.height = '';
				alto = capa.clientHeight;
			}

			return enHueco
				? // getBoundingClientRect va en coordenadas de ventana y la capa
					// arranca en el origen del documento, de ahí el scroll que se suma.
					tira(cajaHueco.top + window.scrollY + cajaHueco.height / 2)
				: enMargenes
					? columnas(texto)
					: tira(alto - anchoMax / 2 - 16);
		};

		const sitios = acomodar();

		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
			elementos.forEach((el, i) => {
				el.style.transform = `translate(${sitios[i].x - anchos[i] / 2}px, ${sitios[i].y - anchos[i] / 2}px)`;
				el.style.visibility = 'visible';
			});
			continue;
		}

		const engine = Matter.Engine.create();
		// Nada de caer: nacen en su sitio.
		engine.gravity.y = 0;

		const fichas: Ficha[] = elementos.map((el, i) => {
			const w = el.offsetWidth;
			const h = el.offsetHeight;
			const cuerpo = Matter.Bodies.rectangle(
				sitios[i].x,
				sitios[i].y,
				// Casi el tamaño del dibujo. Con un cuerpo bastante menor, la pared
				// frena el cuerpo pero la imagen sigue más allá y el borde de la
				// página la recorta. En escritorio sobra sitio y no se nota; en una
				// pantalla estrecha, sí.
				w * 0.95,
				h * 0.95,
				{
					restitution: 0.25,
					friction: 0.55,
					// Alto, para que al soltarla frene ahí en vez de seguir.
					frictionAir: 0.3,
					chamfer: { radius: Math.min(w, h) * 0.22 },
					// Inercia infinita: la física no puede girarlas. Sin esto ruedan al
					// chocar y los logos acaban boca abajo.
					inertia: Infinity,
					// No se ven entre ellas: se superponen.
					collisionFilter: { category: CAT_FICHA, mask: CAT_PARED, group: 0 },
				},
			);
			// Cada una con su ángulo de reposo, pequeño: da el desorden de algo
			// pegado a mano sin llegar a torcer el logo.
			const base = (Math.random() - 0.5) * 0.34;
			Matter.Body.setInertia(cuerpo, Infinity);
			Matter.Body.setAngle(cuerpo, base);
			return { el, cuerpo, mitadX: w / 2, mitadY: h / 2, base };
		});

		const paredes = paredesDe(ancho, alto);
		Matter.Composite.add(engine.world, [...paredes, ...fichas.map((f) => f.cuerpo)]);

		const mouse = Matter.Mouse.create(capa);
		const arrastre = Matter.MouseConstraint.create(engine, {
			mouse,
			constraint: { stiffness: 0.18, render: { visible: false } },
		});
		Matter.Composite.add(engine.world, arrastre);

		// La que se agarra pasa al frente: al superponerse, la última que tocas
		// debe quedar encima, como al despegar una y volver a pegarla.
		let frente = 0;
		Matter.Events.on(arrastre, 'startdrag', (e: { body?: Matter.Body }) => {
			const f = fichas.find((x) => x.cuerpo === e.body);
			if (f) f.el.style.zIndex = String(++frente);
		});

		// matter se queda la rueda y el touchmove del elemento, y con la capa
		// cubriendo la página entera eso la dejaría sin scroll.
		mouse.element.removeEventListener('wheel', mouse.mousewheel);
		mouse.element.removeEventListener('DOMMouseScroll', mouse.mousewheel);
		mouse.element.removeEventListener('touchmove', mouse.mousemove);
		mouse.element.addEventListener(
			'touchmove',
			(e) => {
				if (arrastre.body) {
					e.preventDefault();
					mouse.mousemove(e);
				}
			},
			{ passive: false },
		);

		/*
			matter engancha sus escuchas en la capa, pero la capa tiene
			pointer-events en none: en cuanto el puntero se sale de la pegatina, y
			basta moverlo rápido, los eventos van a la página de debajo. El
			mousemove se pierde y el mouseup también, así que matter nunca se entera
			de que se ha soltado y el cuerpo se queda pegado al cursor.

			Con las escuchas en window el arrastre sigue y termina pase lo que pase
			por debajo. Llamarlas de más es inofensivo: solo fijan posición y botón.
		*/
		const seguir = (e: MouseEvent): void => {
			if (arrastre.body) mouse.mousemove(e);
		};
		const soltar = (e: MouseEvent): void => {
			mouse.mouseup(e);
		};
		window.addEventListener('mousemove', seguir);
		window.addEventListener('mouseup', soltar);
		// El dedo también se sale de la pegatina, igual que el puntero.
		window.addEventListener(
			'touchmove',
			(e) => {
				if (arrastre.body) {
					e.preventDefault();
					mouse.mousemove(e as unknown as MouseEvent);
				}
			},
			{ passive: false },
		);
		// Si el puntero se va de la ventana entera, también hay que soltar.
		window.addEventListener('blur', () => mouse.mouseup(new MouseEvent('mouseup')));

		/*
			matter llama a preventDefault en cualquier touchend que le llegue, y
			estas escuchas van en window: le llegaban TODOS. Y un touchend sin acción
			por defecto no genera clic, así que en el móvil no respondía nada de
			nada, ni los more, ni los details, ni el botón de sonido, ni un enlace.

			Avisarle hay que avisarle igual, o el cuerpo se queda agarrado y su
			estado sucio. Así que se le pasa el evento con preventDefault anulado,
			salvo cuando se venía arrastrando de verdad: ahí sí interesa cortar el
			clic que vendría detrás, o soltar una pegatina encima de un enlace lo
			abriría.
		*/
		const soltarDedo = (e: TouchEvent): void => {
			const inerte = { changedTouches: e.changedTouches, preventDefault: () => {} };
			mouse.mouseup((arrastre.body ? e : inerte) as unknown as MouseEvent);
		};
		window.addEventListener('touchend', soltarDedo);
		window.addEventListener('touchcancel', soltarDedo);

		// Colocar y descubrir ANTES del primer fotograma: si se deja para el rAF,
		// hay un instante en que ya están en el DOM sin transform, amontonadas en
		// la esquina, y eso es lo que se veía destellar.
		for (const f of fichas) {
			colocar(f);
			f.el.style.visibility = 'visible';
		}

		const inst: Instancia = { fichas, paredes, ancho, alto };

		// El motor ya solo trabaja para el arrastre: llevar la que agarras, frenarla
		// al soltarla y no dejar que se salga por las paredes.
		const paso = (): void => {
			requestAnimationFrame(paso);
			Matter.Engine.update(engine, 1000 / 60);
			for (const f of inst.fichas) colocar(f);
		};
		requestAnimationFrame(paso);

		const rehacerParedes = (nuevoAncho: number, nuevoAlto: number): void => {
			inst.ancho = nuevoAncho;
			inst.alto = nuevoAlto;
			Matter.Composite.remove(engine.world, inst.paredes);
			inst.paredes = paredesDe(nuevoAncho, nuevoAlto);
			Matter.Composite.add(engine.world, inst.paredes);
		};

		/*
			Al cambiar la ventana se rehace el reparto entero, no solo las paredes:
			el texto se recentra y con él los márgenes, el hueco aparece o
			desaparece, y el tamaño de cada pegatina cambia de escala. Quedarse
			donde estaban significa quedarse encima del texto o fuera de la pantalla.

			Se recolocan todas, también las que se hubieran movido a mano. Es un
			reparto, y un reparto a medias no es un reparto.
		*/
		let vistoAncho = window.innerWidth;
		let vistoAlto = window.innerHeight;

		window.addEventListener('resize', () => {
			// En un móvil el resize también salta al esconderse la barra del
			// navegador, y ahí no ha cambiado nada que nos importe.
			if (window.innerWidth === vistoAncho && window.innerHeight === vistoAlto) return;
			vistoAncho = window.innerWidth;
			vistoAlto = window.innerHeight;

			const nuevos = acomodar();
			fichas.forEach((f, i) => {
				const lado = anchos[i];
				const factor = lado / (f.mitadX * 2);
				if (Math.abs(factor - 1) > 0.005) {
					Matter.Body.scale(f.cuerpo, factor, factor);
					// scale recalcula la inercia a partir de los vértices, así que la
					// infinita se pierde. El dibujo no se enteraría, que su ángulo lo
					// pone colocar() y no la física, pero el cuerpo sí empezaría a
					// girar y su caja dejaría de coincidir con lo que se ve.
					Matter.Body.setInertia(f.cuerpo, Infinity);
					f.mitadX = lado / 2;
					f.mitadY = lado / 2;
				}
				Matter.Body.setPosition(f.cuerpo, nuevos[i]);
				// Sin esto llegan al sitio nuevo con la velocidad que traían y se
				// pasan de largo.
				Matter.Body.setVelocity(f.cuerpo, { x: 0, y: 0 });
				colocar(f);
			});
			rehacerParedes(ancho, alto);
		});

		/*
			Con la capa midiendo el documento hay que seguirlo: abrir un details lo
			alarga y de eso no avisa ningún resize. Sin esto, las paredes y el
			recorte se quedan a la altura de antes y la mitad de abajo de la página
			queda fuera del alcance de las pegatinas.

			Se observa el body y no la capa: la capa va fuera del flujo, así que su
			alto no entra en el del body y la medición no se realimenta.
		*/
		new ResizeObserver(() => {
			// El modo puede cambiar en cualquier resize, y con la capa fija no hay
			// documento que medir ni alto que ponerle.
			if (!conLaPagina) return;
			const nuevoAlto = medirDocumento();
			if (nuevoAlto !== inst.alto) rehacerParedes(inst.ancho, nuevoAlto);
		}).observe(document.body);
	}
}
