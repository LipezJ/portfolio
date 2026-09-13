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
 */

import Matter from 'matter-js';

const PARED = 400;

interface Ficha {
	el: HTMLElement;
	cuerpo: Matter.Body;
	mitadX: number;
	mitadY: number;
}

interface Instancia {
	fichas: Ficha[];
	paredes: Matter.Body[];
	ancho: number;
	alto: number;
}

function paredesDe(ancho: number, alto: number): Matter.Body[] {
	const opts = { isStatic: true, restitution: 0.1, friction: 0.6 };
	return [
		Matter.Bodies.rectangle(ancho / 2, alto + PARED / 2, ancho + PARED * 2, PARED, opts),
		Matter.Bodies.rectangle(-PARED / 2, alto / 2, PARED, alto * 6, opts),
		Matter.Bodies.rectangle(ancho + PARED / 2, alto / 2, PARED, alto * 6, opts),
		Matter.Bodies.rectangle(ancho / 2, -alto * 3, ancho + PARED * 2, PARED, opts),
	];
}

function colocar(f: Ficha): void {
	const { x, y } = f.cuerpo.position;
	f.el.style.transform = `translate(${x - f.mitadX}px, ${y - f.mitadY}px) rotate(${f.cuerpo.angle}rad)`;
}

export function bindStickers(root: ParentNode = document): void {
	for (const capa of root.querySelectorAll<HTMLElement>('[data-stickers]')) {
		if (capa.dataset.stickersBound !== undefined) continue;
		capa.dataset.stickersBound = '';

		const elementos = [...capa.querySelectorAll<HTMLElement>('[data-sticker]')];
		if (!elementos.length) continue;

		let ancho = window.innerWidth;
		let alto = window.innerHeight;

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
				-h - Math.random() * alto,
				// El cuerpo es algo menor que el dibujo: el troquelado blanco sobresale
				// de la silueta y si se cuenta entero quedan huecos raros al apilarse.
				w * 0.82,
				h * 0.82,
				{
					restitution: 0.25,
					friction: 0.55,
					frictionAir: 0.015,
					chamfer: { radius: Math.min(w, h) * 0.22 },
					angle: (Math.random() - 0.5) * 0.8,
				},
			);
			return { el, cuerpo, mitadX: w / 2, mitadY: h / 2 };
		});

		const paredes = paredesDe(ancho, alto);
		Matter.Composite.add(engine.world, [...paredes, ...fichas.map((f) => f.cuerpo)]);

		const mouse = Matter.Mouse.create(capa);
		const arrastre = Matter.MouseConstraint.create(engine, {
			mouse,
			constraint: { stiffness: 0.18, render: { visible: false } },
		});
		Matter.Composite.add(engine.world, arrastre);

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
		// Si el puntero se va de la ventana entera, también hay que soltar.
		window.addEventListener('blur', () => mouse.mouseup(new MouseEvent('mouseup')));
		window.addEventListener('touchend', (e) => mouse.mouseup(e as unknown as MouseEvent));
		window.addEventListener('touchcancel', (e) => mouse.mouseup(e as unknown as MouseEvent));

		const inst: Instancia = { fichas, paredes, ancho, alto };

		const paso = (): void => {
			requestAnimationFrame(paso);
			Matter.Engine.update(engine, 1000 / 60);
			for (const f of inst.fichas) colocar(f);
		};
		requestAnimationFrame(paso);

		window.addEventListener('resize', () => {
			if (window.innerWidth === inst.ancho && window.innerHeight === inst.alto) return;
			inst.ancho = window.innerWidth;
			inst.alto = window.innerHeight;
			Matter.Composite.remove(engine.world, inst.paredes);
			inst.paredes = paredesDe(inst.ancho, inst.alto);
			Matter.Composite.add(engine.world, inst.paredes);
		});
	}
}
