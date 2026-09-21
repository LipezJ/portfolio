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
 *
 * Va en dos tiempos, y el orden importa. Primero se colocan, que es geometría y
 * no necesita a nadie, y ahí ya se pueden ver. Después llega matter y se hace
 * cargo, que son noventa kilobytes y esperarlos para enseñar una pegatina
 * quieta es lo que hacía que aparecieran tarde, un rato después que el texto.
 */

import type Matter from 'matter-js';

import { sound } from './sound';

const PARED = 400;
/** Paredes y pegatinas en categorías distintas, para que las pegatinas puedan
 *  ignorarse entre ellas y seguir chocando con los bordes. */
const CAT_PARED = 0x0001;
const CAT_FICHA = 0x0002;

interface Sitio {
	x: number;
	y: number;
}

interface Ficha {
	el: HTMLElement;
	mitadX: number;
	mitadY: number;
	/** Ángulo de reposo, fijo. El giro no lo decide la física. */
	base: number;
	/** Dónde va. Manda mientras no hay cuerpo, y después lo manda el cuerpo. */
	sitio: Sitio;
	/** Llega cuando llega matter. Antes de eso la pegatina ya está puesta. */
	cuerpo?: Matter.Body;
	/** Con qué lado se construyó el cuerpo, para saber cuánto escalarlo. */
	ladoCuerpo?: number;
	/**
	 * La han movido a mano, así que el reparto ya no manda sobre ella. Quien la
	 * puso ahí la puso ahí por algo, y que se vuelva sola a su sitio al desplegar
	 * un (more) se lee como que la página deshace lo que acabas de hacer.
	 */
	suelta?: boolean;
	/**
	 * Vive en el flujo de la página, no en la capa.
	 *
	 * Las del blog están dentro de una fila y de una esquina: ahí las pone el
	 * documento y ahí tienen que quedarse cuando nadie las toca. Así que el
	 * cuerpo no dice dónde están, dice cuánto se han apartado de donde estaban.
	 */
	enElFlujo?: boolean;
	/** Donde la puso la página, en coordenadas de la capa. El desvío se mide
	 *  contra esto. */
	origen?: Sitio;
}

/** Inclinación máxima hacia el lado del movimiento, en radianes. */
const LADEO = 0.16;

/** Lo que hay que moverla para que cuente como movida a mano, en píxeles. */
const MUDANZA = 6;

function colocar(f: Ficha): void {
	const { x, y } = f.cuerpo ? f.cuerpo.position : f.sitio;
	// Se ladea un poco hacia donde va y vuelve sola a su ángulo de reposo al
	// frenar, porque la velocidad tiende a cero. Es giro, pero acotado: nunca
	// pasa de unos grados, así que el logo se lee siempre del derecho. Sin
	// cuerpo no hay velocidad y no hay ladeo, que es lo correcto: está quieta.
	const ladeo = f.cuerpo
		? Math.max(-LADEO, Math.min(LADEO, f.cuerpo.velocity.x * 0.028))
		: 0;
	/*
		La del flujo se queda donde la puso la página y se le suma el desvío, que
		es lo que la separa de su origen. Y va en translate y rotate, que son
		propiedades aparte: se componen con el transform que la pegatina ya trae
		—su ladeo de estar pegada torcida— sin pisarlo.
	*/
	if (f.enElFlujo && f.origen) {
		f.el.style.translate = `${x - f.origen.x}px ${y - f.origen.y}px`;
		f.el.style.rotate = `${ladeo}rad`;
		return;
	}
	f.el.style.transform = `translate(${x - f.mitadX}px, ${y - f.mitadY}px) rotate(${f.base + ladeo}rad)`;
}

export function bindStickers(root: ParentNode = document): void {
	for (const capa of root.querySelectorAll<HTMLElement>('[data-stickers]')) {
		if (capa.dataset.stickersBound !== undefined) continue;
		capa.dataset.stickersBound = '';

		const elementos = [...capa.querySelectorAll<HTMLElement>('[data-sticker]')];
		/*
			Las del flujo, que están fuera de la capa: las etiquetas del blog.
			La capa les presta su mundo, sus paredes y su ratón; el sitio se lo
			siguen poniendo ellas.
		*/
		const sueltas = [...root.querySelectorAll<HTMLElement>('[data-sticker-suelto]')];
		if (!elementos.length && !sueltas.length) continue;

		let ancho = capa.clientWidth;
		let alto = capa.clientHeight;

		/**
		 * Lo que mide cada una sin escalar, leído antes de tocar nada. Si el tamaño
		 * de partida se lee del elemento cada vez, la segunda escala se aplica
		 * sobre el resultado de la primera y encogen sin parar.
		 */
		const ORIGINALES = elementos.map((el) => parseFloat(el.style.width));
		/** La más ancha sin escalar, que es la que decide si la tira cabe. */
		const MAYOR = Math.max(...ORIGINALES);

		let anchos = ORIGINALES;
		let anchoMax = Math.max(...anchos);
		/** Si están ancladas a la página o al borde de la ventana. */
		let conLaPagina = false;
		/** Si están amontonadas en el hueco reservado, que es el modo de móvil. */
		let enElHueco = false;

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
			const abajo = enLaPagina(caja.bottom) - parseFloat(getComputedStyle(texto).paddingBottom);
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
		/**
		 * De coordenadas de ventana a coordenadas de la página, sin tocar el scroll.
		 *
		 * Lo natural sería sumarle window.scrollY, y es lo que hacía. Pero en iOS
		 * scrollY no se actualiza de forma fiable mientras la página se está
		 * moviendo: se queda congelado y vuelve en sí al parar. Una caja recién
		 * medida más un scroll viejo da una posición desplazada justo esa
		 * diferencia, y ahí es donde las pegatinas acababan encima del texto al
		 * abrir y cerrar un details.
		 *
		 * La capa arranca en el origen del documento, así que restarle su propia
		 * caja hace la misma conversión sin preguntarle el scroll a nadie: las dos
		 * medidas salen del mismo sistema y del mismo instante, y da igual lo que
		 * scrollY crea que vale.
		 *
		 * Anclada a la ventana su caja empieza en cero, así que esto no hace nada,
		 * que es justo lo que hace falta en ese modo.
		 */
		const enLaPagina = (y: number): number => y - capa.getBoundingClientRect().top;

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

			/*
				Capa sin pegatinas propias: la del blog, que solo presta el mundo. No
				hay reparto que hacer, pero sí hay que anclarla al documento y medirlo,
				que es lo que encierra a las del flujo entre paredes.
			*/
			if (!elementos.length) {
				capa.style.position = 'absolute';
				capa.style.overflow = 'hidden';
				conLaPagina = true;
				enElHueco = false;
				alto = medirDocumento();
				return [];
			}

			const hueco = document.querySelector<HTMLElement>('[data-sticker-hueco]');
			const texto = document.querySelector<HTMLElement>('main');
			const cajaTexto = texto?.getBoundingClientRect();
			const margen = cajaTexto ? Math.min(cajaTexto.left, ancho - cajaTexto.right) : 0;

			/*
				El modo se decide antes que el tamaño, porque el tamaño depende de él.
				Y lo decide una sola cosa: si hay margen a los lados para una pegatina
				entera con su separación y su vaivén. Si lo hay, van ahí; si no, al
				hueco.

				Quien enseña o esconde el hueco es esto, no la hoja de estilos. La
				consulta de medios de index.astro es solo la primera apuesta, para que
				la página no nazca con un hueco que sobra, pero no puede ser la que
				manda: mide el ancho de la ventana con su barra de scroll y aquí se
				mide el ancho útil sin ella. Entre los dos números hay quince píxeles
				de desacuerdo, y en esa franja no había ni márgenes ni hueco: las
				pegatinas se iban al canto de abajo de la ventana, encima del texto.

				El tamaño sin escalar, que en los márgenes la escala es 1 y en el hueco
				lo que decide es si CABEN los márgenes, no lo que midan luego.
			*/
			const hayMargen = texto !== null && margen >= SEP + MAYOR + VAIVEN / 2 + 4;
			if (hueco) hueco.style.display = hayMargen ? 'none' : 'block';
			const altoHueco = hueco && !hayMargen ? hueco.getBoundingClientRect().height : 0;
			const enHueco = altoHueco > 0;

			/*
				Lo que miden, que no sale de un solo sitio.

				En pantalla estrecha ocupan demasiado: doce de ~90px no caben en 375
				sin comerse media pantalla, así que encogen con el ancho.

				Y en el hueco manda además su alto. La tira ocupa lo que mide la más
				ancha más el vaivén que las desordena, y si eso pasa del hueco se sale
				por arriba y por abajo, que es justo el texto que el hueco existe para
				no tapar.

				Gana la más pequeña de las dos. Con el hueco bien dimensionado esto no
				llega a morder nunca, y está para que no pueda volver a pasar: si
				alguien cambia un tamaño o el alto del hueco, encogen en vez de
				comerse un renglón.
			*/
			const porElAncho = ancho < 640 ? Math.max(0.56, ancho / 640) : 1;
			const porElHueco = enHueco ? (altoHueco - VAIVEN - 4) / MAYOR : 1;
			const escala = Math.min(porElAncho, porElHueco);
			elementos.forEach((el, i) => {
				const lado = Math.round(ORIGINALES[i] * escala);
				el.style.width = `${lado}px`;
				el.style.height = `${lado}px`;
			});
			anchos = elementos.map((el) => el.offsetWidth);
			anchoMax = Math.max(...anchos);
			const enMargenes = !enHueco && hayMargen;
			conLaPagina = enHueco || enMargenes;
			enElHueco = enHueco;

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

			/*
				El hueco se mide AQUÍ y no arriba, con la capa ya asentada y en el
				mismo instante que ella. Medirlo antes y convertirlo después era la
				otra mitad del fallo: medirDocumento pone la capa a cero para medir el
				documento sin ella, y al cerrar un details el contenido encoge mientras
				la capa conserva el alto de antes, así que esa capa a cero encoge el
				documento de verdad y el navegador recorta el scroll.

				columnas ya lo hacía bien, que mide su caja dentro. Por eso solo se
				veía en móvil, que es el único modo que medía antes de tiempo.
			*/
			if (enHueco && hueco) {
				const caja = hueco.getBoundingClientRect();
				return tira(enLaPagina(caja.top) + caja.height / 2);
			}
			return enMargenes && texto ? columnas(texto) : tira(alto - anchoMax / 2 - 16);
		};

		const sitios = acomodar();

		/**
		 * Dónde ha puesto la página una suelta, en coordenadas de la capa.
		 *
		 * Se limpia el desvío antes de medir: se quiere dónde la pondría el
		 * documento, no dónde está ahora si ya la han arrastrado. Y el centro de la
		 * caja, que el giro no lo mueve porque gira sobre sí misma.
		 */
		const origenDe = (el: HTMLElement): Sitio => {
			const guardado = el.style.translate;
			el.style.translate = '';
			const r = el.getBoundingClientRect();
			const c = capa.getBoundingClientRect();
			el.style.translate = guardado;
			return { x: r.left - c.left + r.width / 2, y: r.top - c.top + r.height / 2 };
		};

		const fichas: Ficha[] = elementos.map((el, i) => ({
			el,
			mitadX: el.offsetWidth / 2,
			mitadY: el.offsetHeight / 2,
			// Cada una con su ángulo de reposo, pequeño: da el desorden de algo
			// pegado a mano sin llegar a torcer el logo.
			base: (Math.random() - 0.5) * 0.34,
			sitio: sitios[i],
		}));

		/*
			Y las del flujo detrás, con su sitio puesto por el documento. Sin ángulo
			de reposo propio: el suyo lo pone la hoja de estilos, que es la que las
			amontona torcidas, y aquí solo se le suma el ladeo de la inercia.
		*/
		for (const el of sueltas) {
			const origen = origenDe(el);
			fichas.push({
				el,
				mitadX: el.offsetWidth / 2,
				mitadY: el.offsetHeight / 2,
				base: 0,
				sitio: origen,
				enElFlujo: true,
				origen,
			});
		}

		/*
			Puestas ya, sin que exista todavía un solo cuerpo. Colocar es geometría
			y la geometría no necesita a nadie.

			Y ANTES del primer fotograma: si se deja para el rAF hay un instante en
			que ya están en el DOM sin transform, amontonadas en la esquina, y eso
			es lo que se veía destellar.

			Colocada no es lo mismo que lista para verse: quien la descubre es la
			hoja de estilos, y pide además que esté tramada. Ver el logo nítido un
			fotograma y tramado al siguiente es el mismo defecto que el del botón de
			sonido, solo que sin transición que lo delate.
		*/
		for (const f of fichas) {
			colocar(f);
			f.el.dataset.stickerPlaced = '';
		}

		// Sin animación se quedan donde están y no se arrastran, así que no hay
		// nada que simular y la física no se llega a pedir.
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) continue;

		/** Los dos enganches de la física, null mientras no haya llegado. */
		let ajustarMundo: ((ancho: number, alto: number) => void) | null = null;
		let moverCuerpos: (() => void) | null = null;

		/*
			De aquí en adelante es matter, y matter son noventa kilobytes. Cargado
			con el resto bloqueaba todo esto de arriba, que no lo necesita: las
			pegatinas no se veían hasta que el navegador había bajado, parseado y
			ejecutado la librería entera, un buen rato después que el texto. Pedido
			aparte, se colocan enseguida y la física llega cuando llega.

			Lo único que no se puede hacer hasta entonces es arrastrarlas.
		*/
		const arrancarFisica = async (): Promise<void> => {
			const { default: Matter } = await import('matter-js');

			// Aquí dentro y no fuera: fuera de la carga diferida, Matter es solo un
			// tipo y esto reventaba con un "Matter is not defined".
			const paredesDe = (ancho: number, alto: number): Matter.Body[] => {
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
			};

			const engine = Matter.Engine.create();
			// Nada de caer: nacen en su sitio.
			engine.gravity.y = 0;

			const cuerpos = fichas.map((f) => {
				const lado = f.mitadX * 2;
				const cuerpo = Matter.Bodies.rectangle(
					f.sitio.x,
					f.sitio.y,
					// Casi el tamaño del dibujo. Con un cuerpo bastante menor, la pared
					// frena el cuerpo pero la imagen sigue más allá y el borde de la
					// página la recorta. En escritorio sobra sitio y no se nota; en una
					// pantalla estrecha, sí.
					lado * 0.95,
					lado * 0.95,
					{
						restitution: 0.25,
						friction: 0.55,
						// Alto, para que al soltarla frene ahí en vez de seguir.
						frictionAir: 0.3,
						chamfer: { radius: lado * 0.22 },
						// Inercia infinita: la física no puede girarlas. Sin esto ruedan
						// al chocar y los logos acaban boca abajo.
						inertia: Infinity,
						// No se ven entre ellas: se superponen.
						collisionFilter: { category: CAT_FICHA, mask: CAT_PARED, group: 0 },
					},
				);
				Matter.Body.setInertia(cuerpo, Infinity);
				Matter.Body.setAngle(cuerpo, f.base);
				f.cuerpo = cuerpo;
				f.ladoCuerpo = lado;
				return cuerpo;
			});

			const paredes = paredesDe(ancho, alto);
			Matter.Composite.add(engine.world, [...paredes, ...cuerpos]);

			const mouse = Matter.Mouse.create(capa);
			const arrastre = Matter.MouseConstraint.create(engine, {
				mouse,
				constraint: { stiffness: 0.18, render: { visible: false } },
			});
			Matter.Composite.add(engine.world, arrastre);

			// La que se agarra pasa al frente: al superponerse, la última que tocas
			// debe quedar encima, como al despegar una y volver a pegarla.
			let frente = 0;
			let arrastrada: Ficha | null = null;
			let desde: Sitio | null = null;
			Matter.Events.on(arrastre, 'startdrag', (e: { body?: Matter.Body }) => {
				const f = fichas.find((x) => x.cuerpo === e.body);
				if (f?.cuerpo) {
					f.el.style.zIndex = String(++frente);
					arrastrada = f;
					desde = { x: f.cuerpo.position.x, y: f.cuerpo.position.y };
				}
				sound.play('grab');
			});
			// matter solo lo lanza si de verdad llevaba un cuerpo agarrado, así que no
			// suena por soltar el botón en cualquier parte.
			Matter.Events.on(arrastre, 'enddrag', () => {
				/*
					Un toque no es una mudanza.

					Se marca al soltar y no al agarrar, y solo si ha cambiado de sitio
					de verdad: en un móvil se toca una pegatina sin querer a poco que
					se falle un enlace, y marcarla ahí la desengancharía del reparto
					para siempre sin que nadie la haya movido.
				*/
				const f: Ficha | null = arrastrada;
				if (f?.cuerpo && desde) {
					const dx = f.cuerpo.position.x - desde.x;
					const dy = f.cuerpo.position.y - desde.y;
					if (dx * dx + dy * dy > MUDANZA * MUDANZA) {
						f.suelta = true;
						/*
							En la lista, la pegatina va dentro del enlace de la entrada.
							Sin esto, arrastrarla y soltarla abre la entrada: justo lo
							contrario de lo que acabas de hacer. Un clic sin arrastre sí la
							abre, que ahí el enlace es lo que se quiere.
						*/
						if (f.enElFlujo) {
							f.el.addEventListener(
								'click',
								(ev) => {
									ev.preventDefault();
									ev.stopPropagation();
								},
								{ capture: true, once: true },
							);
						}
					}
				}
				arrastrada = null;
				desde = null;
				sound.play('place');
			});

			/*
				Las del flujo están fuera de la capa, así que a matter no le llega que
				las pulses: sus escuchas de bajada van en el elemento de su ratón, que
				es la capa. Se le reenvían y a partir de ahí el arrastre es el de
				siempre, que seguir y soltar ya van en window.

				El evento se le pasa tal cual, sin neutralizar: sobre una pegatina, el
				preventDefault que matter le hace al touchstart es justo lo que se
				quiere, que corta el desplazamiento y el clic. El resto de la fila
				sigue abriéndose.
			*/
			for (const el of sueltas) {
				el.addEventListener('mousedown', (e) => mouse.mousedown(e));
				el.addEventListener('touchstart', (e) => mouse.mousedown(e as unknown as MouseEvent), {
					passive: false,
				});
			}

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

			// El motor ya solo trabaja para el arrastre: llevar la que agarras,
			// frenarla al soltarla y no dejar que se salga por las paredes.
			const paso = (): void => {
				requestAnimationFrame(paso);
				Matter.Engine.update(engine, 1000 / 60);
				for (const f of fichas) colocar(f);
			};
			requestAnimationFrame(paso);

			let muros = paredes;
			ajustarMundo = (nuevoAncho, nuevoAlto) => {
				Matter.Composite.remove(engine.world, muros);
				muros = paredesDe(nuevoAncho, nuevoAlto);
				Matter.Composite.add(engine.world, muros);
			};

			// Los cuerpos van detrás de las fichas, que son las que saben dónde y de
			// qué tamaño toca. Antes de que exista un cuerpo no hay nada que seguir.
			moverCuerpos = () => {
				for (const f of fichas) {
					if (!f.cuerpo || f.ladoCuerpo === undefined) continue;
					const lado = f.mitadX * 2;
					const factor = lado / f.ladoCuerpo;
					if (Math.abs(factor - 1) > 0.005) {
						Matter.Body.scale(f.cuerpo, factor, factor);
						// scale recalcula la inercia a partir de los vértices, así que la
						// infinita se pierde. El dibujo no se enteraría, que su ángulo lo
						// pone colocar() y no la física, pero el cuerpo sí empezaría a
						// girar y su caja dejaría de coincidir con lo que se ve.
						Matter.Body.setInertia(f.cuerpo, Infinity);
						f.ladoCuerpo = lado;
					}
					Matter.Body.setPosition(f.cuerpo, f.sitio);
					// Sin esto llegan al sitio nuevo con la velocidad que traían y se
					// pasan de largo.
					Matter.Body.setVelocity(f.cuerpo, { x: 0, y: 0 });
				}
			};
		};

		void arrancarFisica();

		/*
			Al cambiar la ventana se rehace el reparto entero, no solo las paredes:
			el texto se recentra y con él los márgenes, el hueco aparece o
			desaparece, y el tamaño de cada pegatina cambia de escala. Quedarse
			donde estaban significa quedarse encima del texto o fuera de la pantalla.

			Se recolocan todas, también las que se hubieran movido a mano. Es un
			reparto, y un reparto a medias no es un reparto.
		*/
		/**
		 * El reparto entero con las medidas de ahora, dibujo y física incluidos.
		 *
		 * Con reparto en cierto vuelve a repartirlas todas y las movidas a mano
		 * dejan de serlo. Con falso, esas se quedan donde las dejaron y solo se
		 * recolocan las que nadie ha tocado.
		 */
		const reacomodar = (reparto: boolean): void => {
			const nuevos = acomodar();
			fichas.forEach((f, i) => {
				/*
					Una del flujo no entra en el reparto: su sitio lo pone el documento.
					Lo que sí hace falta es volver a leerlo —la fila puede haber bajado
					al desplegar algo— y correr el cuerpo lo mismo, para que siga encima
					de su fila en vez de quedarse flotando donde estaba.
				*/
				if (f.enElFlujo) {
					const antes = f.origen;
					const ahora = origenDe(f.el);
					f.origen = ahora;
					f.mitadX = f.el.offsetWidth / 2;
					f.mitadY = f.el.offsetHeight / 2;
					if (antes && f.cuerpo) {
						f.sitio = {
							x: f.cuerpo.position.x + (ahora.x - antes.x),
							y: f.cuerpo.position.y + (ahora.y - antes.y),
						};
					} else {
						f.sitio = ahora;
					}
					return;
				}
				f.mitadX = anchos[i] / 2;
				f.mitadY = anchos[i] / 2;
				if (reparto) f.suelta = false;
				// Su sitio pasa a ser el que tiene, o moverCuerpos la devolvería al
				// que le tocaba antes de que la movieran.
				if (f.suelta) {
					if (f.cuerpo) f.sitio = { x: f.cuerpo.position.x, y: f.cuerpo.position.y };
				} else {
					f.sitio = nuevos[i];
				}
			});
			// Y si la física aún no ha llegado, con recolocar el dibujo basta.
			moverCuerpos?.();
			for (const f of fichas) colocar(f);
			ajustarMundo?.(ancho, alto);
		};

		let vistoAncho = window.innerWidth;
		let vistoAlto = window.innerHeight;

		/*
			Manda el ancho, no el alto.

			En un móvil la barra del navegador se esconde al hacer scroll y con
			ella cambia innerHeight, que dispara un resize. Esto lo sabía y lo
			comprobaba mal: se saltaba el aviso solo si NO había cambiado ninguna de
			las dos medidas, así que el de la barra pasaba de largo y repartía de
			nuevo. Cada vez que Safari escondía la barra, las pegatinas que hubieras
			movido volvían a su sitio. De ahí lo de "se reinician al hacer scroll,
			pero no siempre": pasa en el scroll que esconde o saca la barra, no en
			todos.

			El reparto solo depende del ancho. De él salen la escala, el modo, los
			márgenes y el hueco, y de ahí sale dónde va cada una. El alto solo
			importa cuando los montones cuelgan del canto de la ventana, que es el
			modo en el que no están ancladas a la página; y ni siquiera ahí es un
			reparto nuevo, así que las movidas a mano se quedan donde están.

			Girar el teléfono cambia las dos, así que entra por el ancho y reparte,
			que es lo correcto: ahí sí cambia todo. Y es la única vía que queda: en
			iOS el viewport de maquetación solo cambia al girar, así que innerWidth
			se queda quieto cuando la barra entra y sale.

			Es el apaño conocido para los "phantom resize events" de iOS 15, que
			rompieron el arrastre en dnd-kit, react-beautiful-dnd y Swiper con este
			mismo síntoma:
			johnkavanagh.co.uk/articles/understanding-phantom-window-resize-events-in-ios
		*/
		window.addEventListener('resize', () => {
			const anchoNuevo = window.innerWidth;
			const altoNuevo = window.innerHeight;
			const cambioElAncho = anchoNuevo !== vistoAncho;
			const cambioElAlto = altoNuevo !== vistoAlto;
			vistoAncho = anchoNuevo;
			vistoAlto = altoNuevo;

			if (cambioElAncho) {
				// Reparto nuevo, movidas a mano incluidas: cambian la escala, el modo
				// y los márgenes, y la que estuviera colocada a mano acabaría fuera de
				// la pantalla o encima del texto.
				reacomodar(true);
				return;
			}
			if (!cambioElAlto) return;
			// Ancladas a la página no hay nada que rehacer: cuelgan del hueco o del
			// final del texto, y ninguno de los dos se mueve porque la ventana sea
			// más alta.
			if (conLaPagina) return;
			reacomodar(false);
		});

		/*
			Cuando el contenido cambia de alto, y de eso no avisa ningún resize:
			desplegar un (more) o abrir un details alarga la página sin que salte
			ninguno.

			Una pegatina está pegada, así que lo suyo es no moverse. Lo que pasa es
			que en móvil está pegada al hueco reservado, y el hueco es contenido: va
			en el flujo, así que baja con todo lo que tiene encima. Ahí seguirlo es
			quedarse quieta respecto al papel; no seguirlo sería despegarse y acabar
			encima del texto.

			En los márgenes no hay nada de eso. El sitio donde está pegada es margen
			vacío, y ese no se mueve porque alguien abra un details más abajo. Se
			quedan, que es lo que hace una pegatina.

			Lo que sí hace falta en los dos modos es volver a medir el documento:
			las paredes de la física encierran la página entera, y si crece sin que
			se enteren, la mitad de abajo queda fuera del alcance.

			Se observa el body y no la capa: la capa va fuera del flujo, así que su
			alto no entra en el del body y esto no se realimenta.
		*/
		new ResizeObserver(() => {
			// Con la capa fija no hay nada que seguir: ahí los montones cuelgan del
			// canto de la ventana, que el contenido no mueve.
			if (!conLaPagina) return;
			if (enElHueco) {
				// Las movidas a mano se quedan donde están: desplegar un (more) no es
				// motivo para deshacer lo que acaba de hacer quien mira la página.
				reacomodar(false);
				return;
			}
			alto = medirDocumento();
			ajustarMundo?.(ancho, alto);
		}).observe(document.body);
	}
}
