/**
 * El (more) que se despliega, enganchado por atributo.
 *
 * Vive aquí y no dentro del componente porque un script de componente solo
 * viaja a las páginas que lo usan, y esto tiene que valer también para el
 * markdown del blog, que escribe su HTML a mano y no pasa por el componente.
 * Igual que el sonido, la onda y el tramado: lo que manda es el atributo.
 */

import { sound } from './sound';


export function bindMore(root: ParentNode = document): void {
	for (const el of root.querySelectorAll<HTMLElement>('[data-more]')) {
		if (el.dataset.moreBound !== undefined) continue;
		el.dataset.moreBound = '';

		const short = el.querySelector<HTMLElement>('[data-more-short]');
		const full = el.querySelector<HTMLElement>('[data-more-full]');
		if (!short || !full) continue;

		const toggle = () => {
			const open = el.getAttribute('aria-expanded') === 'true';
			el.setAttribute('aria-expanded', String(!open));
			// Mostrar y ocultar lo hace el CSS a partir de aria-expanded. Aquí
			// solo queda lo que el CSS no puede: que el lector de pantalla no
			// anuncie el disparador cuando ya está desplegado.
			short.setAttribute('aria-hidden', String(!open));
			full.setAttribute('aria-hidden', String(open));
			sound.play(open ? 'close' : 'reveal');
		};

		let downX = 0;
		let downY = 0;

		el.addEventListener('mousedown', (e) => {
			// El segundo mousedown de un doble clic es el que arranca la selección.
			// Lo cortamos ahí y no con user-select, para no romper el copiar.
			if (e.detail > 1) e.preventDefault();
			downX = e.clientX;
			downY = e.clientY;
		});

		el.addEventListener('click', (e) => {
			// Arrastrar también dispara click al soltar, y plegaba el texto justo
			// mientras lo seleccionabas. detail === 0 es un click de teclado.
			if (e.detail > 0 && Math.hypot(e.clientX - downX, e.clientY - downY) > 4) return;
			toggle();
		});
		el.addEventListener('keydown', (e) => {
			if (e.key !== 'Enter' && e.key !== ' ') return;
			e.preventDefault();
			toggle();
		});
	}
}
