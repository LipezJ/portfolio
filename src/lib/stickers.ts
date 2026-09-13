/**
 * Pegatinas con física sobre toda la ventana.
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
 * La gravedad y las colisiones entre pegatinas solo actúan en la entrada, y se
 * apagan en cuanto se posan. Las dos cosas por el mismo motivo: una pegatina se
 * queda donde la pegas. Si al soltarla vuelve a caer no es una pegatina, es un
 * objeto cayendo; y si al poner una encima de otra la de debajo sale empujada,
 * tampoco: las pegatinas se superponen, no se apartan.
 *
 * Siguen chocando con las paredes, que es lo que impide perderlas fuera de la
 * ventana.
 */

import Matter from 'matter-js';

const PARED = 400;
/** Paredes y pegatinas en categorías distintas, para poder desactivar solo las
 *  colisiones entre pegatinas y conservar las de los bordes. */
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

		/*
			En pantalla estrecha las pegatinas ocupan demasiado: doce de ~90px no
			caben en 375 y se estorban al caer. Se reducen solo aquí; por encima de
			640 el factor es 1 y el escritorio queda exactamente igual.
		*/
		const escala = ancho < 640 ? Math.max(0.56, ancho / 640) : 1;
		if (escala < 1) {
			for (const el of elementos) {
				const lado = Math.round(parseFloat(el.style.width) * escala);
				el.style.width = `${lado}px`;
				el.style.height = `${lado}px`;
			}
		}

		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
			// Quietas y repartidas por el borde inferior.
			const paso = ancho / (elementos.length + 1);
			elementos.forEach((el, i) => {
				const w = el.offsetWidth;
				el.style.transform = `translate(${paso * (i + 1) - w / 2}px, ${alto - w - 16}px)`;
			});
			continue;
		}

		const engine = Matter.Engine.create();
		engine.gravity.y = 1;

		const fichas: Ficha[] = elementos.map((el, i) => {
			const w = el.offsetWidth;
			const h = el.offsetHeight;
			const cuerpo = Matter.Bodies.rectangle(
				((i + 0.5) / elementos.length) * ancho,
				-h - Math.random() * alto * 0.5,
				// Casi el tamaño del dibujo. Con un cuerpo bastante menor, la pared
				// frena el cuerpo pero la imagen sigue más allá y el borde de la
				// ventana la recorta. En escritorio sobra sitio y no se nota; en una
				// pantalla estrecha, sí.
				w * 0.95,
				h * 0.95,
				{
					restitution: 0.25,
					friction: 0.55,
					frictionAir: 0.015,
					chamfer: { radius: Math.min(w, h) * 0.22 },
					// Inercia infinita: la física no puede girarlas. Sin esto ruedan al
					// caer y al chocar, y los logos acaban boca abajo.
					inertia: Infinity,
					// Al caer chocan entre sí para que la pila quede desordenada.
					collisionFilter: { category: CAT_FICHA, mask: CAT_PARED | CAT_FICHA, group: 0 },
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
		// cubriendo la ventana entera eso dejaría la página sin scroll.
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
		window.addEventListener('touchend', (e) => mouse.mouseup(e as unknown as MouseEvent));
		window.addEventListener('touchcancel', (e) => mouse.mouseup(e as unknown as MouseEvent));

		const inst: Instancia = { fichas, paredes, ancho, alto };

		let asentado = false;
		let fotogramas = 0;
		let quietos = 0;

		const pegar = (): void => {
			asentado = true;
			engine.gravity.y = 0;
			for (const f of inst.fichas) {
				f.cuerpo.frictionAir = 0.3;
				// Dejan de verse entre ellas: a partir de aquí se superponen.
				f.cuerpo.collisionFilter.mask = CAT_PARED;
			}
		};

		const paso = (): void => {
			requestAnimationFrame(paso);
			Matter.Engine.update(engine, 1000 / 60);

			if (!asentado) {
				fotogramas++;
				// Hay que exigir que estén quietas VARIOS fotogramas seguidos y no
				// solo uno: con una sola lectura se apaga la gravedad mientras alguna
				// sigue cayendo y se queda flotando a media página. La más rezagada
				// manda, así que se mira la velocidad máxima y no la suma.
				const masRapida = inst.fichas.reduce((m, f) => Math.max(m, f.cuerpo.speed), 0);
				quietos = masRapida < 0.4 ? quietos + 1 : 0;
				// El tope es la red de seguridad por si alguna se queda rebotando.
				if ((fotogramas > 150 && quietos > 25) || fotogramas > 600) pegar();
			}

			for (const f of inst.fichas) colocar(f);
		};
		requestAnimationFrame(paso);

		window.addEventListener('resize', () => {
			if (capa.clientWidth === inst.ancho && capa.clientHeight === inst.alto) return;
			inst.ancho = capa.clientWidth;
			inst.alto = capa.clientHeight;
			Matter.Composite.remove(engine.world, inst.paredes);
			inst.paredes = paredesDe(inst.ancho, inst.alto);
			Matter.Composite.add(engine.world, inst.paredes);
		});
	}
}
