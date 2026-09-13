/**
 * Pegatinas con física: caen, se apilan y se pueden arrastrar.
 *
 * La simulación la lleva matter-js, pero el dibujo NO. Cada pegatina sigue
 * siendo un elemento del DOM y en cada fotograma se le escribe el transform
 * que le corresponde a su cuerpo. Así los logos siguen siendo SVG nítidos, el
 * aspecto de troquelado se hace con CSS, y quedan en el árbol de
 * accesibilidad; con el renderizador de canvas de matter habría que pasarlos a
 * mapa de bits y se perdería todo eso.
 */

import Matter from 'matter-js';

/**
 * Radio del círculo visible. El elemento mide 56px de lado y el preflight de
 * Tailwind pone box-sizing: border-box en todo, así que el borde de 3px va por
 * dentro: el círculo que se ve es de 56, no de 62, y su radio es 28.
 */
const RADIO = 28;
const PARED = 200;

interface Instancia {
	engine: Matter.Engine;
	cuerpos: Matter.Body[];
	elementos: HTMLElement[];
	paredes: Matter.Body[];
	raf: number;
	ancho: number;
	alto: number;
}

function paredesDe(ancho: number, alto: number): Matter.Body[] {
	const opts = { isStatic: true, restitution: 0.2 };
	return [
		// Suelo, laterales y un techo muy alto para que no se escapen al lanzarlas.
		Matter.Bodies.rectangle(ancho / 2, alto + PARED / 2, ancho + PARED * 2, PARED, opts),
		Matter.Bodies.rectangle(-PARED / 2, alto / 2, PARED, alto * 4, opts),
		Matter.Bodies.rectangle(ancho + PARED / 2, alto / 2, PARED, alto * 4, opts),
		Matter.Bodies.rectangle(ancho / 2, -alto * 2, ancho + PARED * 2, PARED, opts),
	];
}

function colocar(el: HTMLElement, cuerpo: Matter.Body): void {
	const { x, y } = cuerpo.position;
	el.style.transform = `translate(${x - RADIO}px, ${y - RADIO}px) rotate(${cuerpo.angle}rad)`;
}

/** Sin movimiento: una fila centrada y quieta. */
function estatico(contenedor: HTMLElement, elementos: HTMLElement[]): void {
	const ancho = contenedor.clientWidth;
	const paso = Math.min(RADIO * 2 + 10, ancho / elementos.length);
	const inicio = (ancho - paso * (elementos.length - 1)) / 2;
	elementos.forEach((el, i) => {
		el.style.transform = `translate(${inicio + i * paso - RADIO}px, ${contenedor.clientHeight / 2 - RADIO}px)`;
	});
}

export function bindStickers(root: ParentNode = document): void {
	for (const contenedor of root.querySelectorAll<HTMLElement>('[data-stickers]')) {
		if (contenedor.dataset.stickersBound !== undefined) continue;
		contenedor.dataset.stickersBound = '';

		const elementos = [...contenedor.querySelectorAll<HTMLElement>('[data-sticker]')];
		if (!elementos.length) continue;

		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
			estatico(contenedor, elementos);
			continue;
		}

		const ancho = contenedor.clientWidth;
		const alto = contenedor.clientHeight;

		const engine = Matter.Engine.create();
		engine.gravity.y = 1;

		const cuerpos = elementos.map((_, i) =>
			Matter.Bodies.circle(
				// Repartidas a lo ancho y por encima del marco, para que entren cayendo.
				((i + 0.5) / elementos.length) * ancho,
				-RADIO - Math.random() * alto * 1.5,
				RADIO,
				{ restitution: 0.45, friction: 0.35, frictionAir: 0.01 },
			),
		);

		const paredes = paredesDe(ancho, alto);
		Matter.Composite.add(engine.world, [...paredes, ...cuerpos]);

		const mouse = Matter.Mouse.create(contenedor);
		const arrastre = Matter.MouseConstraint.create(engine, {
			mouse,
			constraint: { stiffness: 0.2, render: { visible: false } },
		});
		Matter.Composite.add(engine.world, arrastre);

		// matter se queda la rueda y el gesto de arrastre del ratón, y en móvil eso
		// impide desplazar la página por encima de las pegatinas.
		mouse.element.removeEventListener('wheel', mouse.mousewheel);
		mouse.element.removeEventListener('DOMMouseScroll', mouse.mousewheel);
		mouse.element.removeEventListener('touchmove', mouse.mousemove);
		mouse.element.addEventListener(
			'touchmove',
			(e) => {
				// Solo secuestramos el dedo si de verdad hay una pegatina agarrada.
				if (arrastre.body) {
					e.preventDefault();
					mouse.mousemove(e);
				}
			},
			{ passive: false },
		);

		const inst: Instancia = { engine, cuerpos, elementos, paredes, raf: 0, ancho, alto };

		const paso = (): void => {
			inst.raf = requestAnimationFrame(paso);
			Matter.Engine.update(engine, 1000 / 60);
			for (let i = 0; i < cuerpos.length; i++) colocar(elementos[i]!, cuerpos[i]!);
		};

		// No simulamos mientras no se vea: es lo último de la página y casi nadie
		// llega de inmediato.
		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry?.isIntersecting) {
					if (!inst.raf) inst.raf = requestAnimationFrame(paso);
				} else if (inst.raf) {
					cancelAnimationFrame(inst.raf);
					inst.raf = 0;
				}
			},
			{ threshold: 0.1 },
		);
		observer.observe(contenedor);

		window.addEventListener('resize', () => {
			const nuevoAncho = contenedor.clientWidth;
			const nuevoAlto = contenedor.clientHeight;
			if (nuevoAncho === inst.ancho && nuevoAlto === inst.alto) return;
			Matter.Composite.remove(engine.world, inst.paredes);
			inst.paredes = paredesDe(nuevoAncho, nuevoAlto);
			Matter.Composite.add(engine.world, inst.paredes);
			inst.ancho = nuevoAncho;
			inst.alto = nuevoAlto;
		});
	}
}
