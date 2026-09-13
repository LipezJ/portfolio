/**
 * La visita guiada: una mano que señala tres cosas y se va.
 *
 * Sale una vez y no vuelve. Un aviso de "esto se puede tocar" sirve la primera
 * vez; a partir de la segunda es un estorbo que tapa la página cada vez que
 * entras. Se apunta en localStorage nada más empezar, de modo que recargar a
 * mitad tampoco la repite.
 *
 * Y se va en cuanto tocas algo. Si ya estás usando la página, el tutorial de
 * cómo usarla sobra.
 */

const VISTO = 'portfolio:tour-seen';

/** Lo que espera antes de empezar, para dar tiempo a que todo esté puesto. */
const ARRANQUE = 900;
/** Lo que se queda en cada sitio, ya parada. */
const PARADA = 1700;
/** Lo que tarda en ir de uno al siguiente. Cuadra con la transición del CSS. */
const VIAJE = 650;

/** Media mano: lo que hay que restar para centrar el dedo en el objetivo. */
const MEDIA_MANO = 14;

interface Paso {
	objetivo(): Element | null | undefined;
	texto: string;
}

const PASOS: Paso[] = [
	{
		objetivo: () => document.querySelector('[data-sound-toggle]'),
		texto: 'Turn the sound on',
	},
	{
		objetivo: () => document.querySelector('[data-tour-avatar]'),
		texto: 'That’s me',
	},
	{
		// La última de la lista es la que queda encima del montón, así que es la
		// que se ve entera y la que se agarraría de verdad.
		objetivo: () => [...document.querySelectorAll('[data-sticker]')].at(-1),
		texto: 'Drag the logos around',
	},
];

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

	// Cualquier gesto sobre la página la cancela, incluido el scroll: las tres
	// cosas que señala están arriba, y si te has ido de ahí ya no señala nada.
	for (const tipo of ['pointerdown', 'keydown', 'wheel', 'touchmove'] as const) {
		window.addEventListener(tipo, terminar, { signal: corte.signal, passive: true });
	}

	const señalar = (objetivo: Element, texto: string): void => {
		const caja = objetivo.getBoundingClientRect();
		const centro = caja.left + caja.width / 2;

		// Debajo del objetivo y apuntándolo: el icono es un dedo hacia arriba.
		mano.style.setProperty('--x', `${centro - MEDIA_MANO}px`);
		mano.style.setProperty('--y', `${caja.bottom + 6}px`);

		// El globo hay que escribirlo antes de medirlo, y medirlo antes de
		// centrarlo, porque lo ancho que sea depende de lo que ponga.
		dicho.textContent = texto;
		const ancho = dicho.offsetWidth;
		const izquierda = Math.min(Math.max(8, centro - ancho / 2), window.innerWidth - ancho - 8);
		dicho.style.setProperty('--x', `${izquierda}px`);
		dicho.style.setProperty('--y', `${caja.bottom + 44}px`);

		// Reiniciar la animación del toque: quitar el atributo no basta si se
		// vuelve a poner en el mismo fotograma, hay que forzar un reflujo entre
		// medias para que el navegador se entere de que es otra animación.
		delete mano.dataset.toca;
		void mano.offsetWidth;
		mano.dataset.toca = '';
	};

	void (async () => {
		await dormir(ARRANQUE);
		if (cortada) return;

		const paradas = PASOS.map((p) => ({ objetivo: p.objetivo(), texto: p.texto })).filter(
			(p): p is { objetivo: Element; texto: string } => p.objetivo instanceof Element,
		);
		if (!paradas.length) return;

		apuntarVisto();
		capa.hidden = false;

		// El primer sitio se pone sin transición, o la mano entraría volando desde
		// la esquina superior izquierda, que es donde está mientras no tiene sitio.
		capa.dataset.quieto = '';
		señalar(paradas[0].objetivo, paradas[0].texto);
		await new Promise(requestAnimationFrame);
		delete capa.dataset.quieto;

		for (let i = 0; i < paradas.length; i++) {
			if (cortada) return;
			// La primera ya está puesta de la vuelta de arriba.
			if (i > 0) {
				señalar(paradas[i].objetivo, paradas[i].texto);
				await dormir(VIAJE);
				if (cortada) return;
			}
			await dormir(PARADA);
		}

		terminar();
	})();
}
