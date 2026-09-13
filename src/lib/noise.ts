/**
 * Ruido de valor 3D compartido.
 *
 * Lo usan el dither de los iconos de proyecto y el grano de las ondas. Está
 * aquí y no duplicado en cada uno para que ambos tengan exactamente la misma
 * textura.
 */

/**
 * Ruido de valor 3D. El hash es determinista y sin estado, así que no hace
 * falta tabla de permutación: dadas unas coordenadas enteras siempre devuelve
 * el mismo valor, y entre ellas interpolamos.
 */
export function hash3(x: number, y: number, z: number): number {
	let n = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177)) | 0;
	n = (n ^ (n >>> 13)) | 0;
	n = Math.imul(n, 1274126177) | 0;
	return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

// Smoothstep: sin esto la interpolación es lineal y se ven los bordes de la
// rejilla del ruido como rombos.
const fade = (t: number): number => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function noise3(x: number, y: number, z: number): number {
	const xi = Math.floor(x);
	const yi = Math.floor(y);
	const zi = Math.floor(z);
	const xf = fade(x - xi);
	const yf = fade(y - yi);
	const zf = fade(z - zi);

	const c = (dx: number, dy: number, dz: number): number => hash3(xi + dx, yi + dy, zi + dz);

	const a = lerp(lerp(c(0, 0, 0), c(1, 0, 0), xf), lerp(c(0, 1, 0), c(1, 1, 0), xf), yf);
	const b = lerp(lerp(c(0, 0, 1), c(1, 0, 1), xf), lerp(c(0, 1, 1), c(1, 1, 1), xf), yf);
	return lerp(a, b, zf);
}

/** Dos octavas: la primera da las masas grandes, la segunda el grano. */
export function fbm(x: number, y: number, z: number): number {
	return noise3(x, y, z) * 0.68 + noise3(x * 2.4, y * 2.4, z * 1.8) * 0.32;
}
