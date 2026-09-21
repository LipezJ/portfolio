/**
 * Que los clips en bucle arranquen también donde el autoplay no basta.
 *
 * El atributo autoplay es una petición, no una orden, y en un móvil se deniega
 * más de lo que parece: iOS no reproduce nada en modo de bajo consumo, y varios
 * navegadores solo dejan arrancar lo que está a la vista. El resultado es un
 * clip que se queda en su primer fotograma sin decir por qué.
 *
 * Así que se le vuelve a pedir cuando entra en pantalla, que es el momento en
 * que el navegador es más propenso a decir que sí, y se pausa al salir para no
 * gastar batería decodificando algo que nadie mira.
 *
 * Si aun así no arranca, no pasa nada: el poster deja a la vista el fotograma
 * que importa, y el pie de figura cuenta lo que se vería.
 */

/** Reintenta la reproducción sin ensuciar la consola si el navegador dice que no. */
function intentar(video: HTMLVideoElement): void {
	const promesa = video.play();
	// Safari antiguo devuelve undefined en vez de una promesa.
	if (promesa) promesa.catch(() => {});
}

export function bindVideo(root: ParentNode = document): void {
	const videos = root.querySelectorAll<HTMLVideoElement>('video[autoplay][loop]');
	if (!videos.length) return;

	// Quien pide menos movimiento no quiere un bucle repitiéndose al lado del
	// texto. Se queda el poster, que cuenta lo mismo quieto.
	if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
		for (const video of videos) {
			video.removeAttribute('autoplay');
			video.pause();
		}
		return;
	}

	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				const video = entry.target as HTMLVideoElement;
				if (entry.isIntersecting) intentar(video);
				else video.pause();
			}
		},
		{ threshold: 0.25 },
	);

	for (const video of videos) {
		if (video.dataset.videoBound !== undefined) continue;
		video.dataset.videoBound = '';

		// Red por si el bucle nativo se rinde: con loop puesto esto no llega a
		// dispararse nunca, y cuando se dispara es justo porque hacía falta.
		video.addEventListener('ended', () => {
			video.currentTime = 0;
			intentar(video);
		});

		observer.observe(video);
	}
}
