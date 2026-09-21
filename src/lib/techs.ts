/**
 * Las tecnologías, en un solo sitio.
 *
 * Las usan las pegatinas de la portada y las etiquetas del blog, y el esquema
 * de las entradas las valida contra esta lista: escribir "Reactt" en el
 * frontmatter rompe el build en vez de dejar un hueco.
 *
 * El orden importa para las pegatinas y no para el blog: manda el orden del
 * documento, así que la última de la lista queda encima de su montón. Por eso
 * Java va al final y PostgreSQL al principio.
 */
export const TECHS = [
	{ name: 'PostgreSQL', icon: 'logos:postgresql', size: 94 },
	{ name: 'Node.js', icon: 'logos:nodejs-icon-alt', size: 88 },
	{ name: 'TypeScript', icon: 'logos:typescript-icon', size: 80 },
	{ name: 'JavaScript', icon: 'logos:javascript', size: 76 },
	{ name: 'Rust', icon: 'logos:rust', size: 88 },
	{ name: 'Python', icon: 'logos:python', size: 84 },
	{ name: 'React', icon: 'logos:react', size: 96 },
	{ name: 'Astro', icon: 'logos:astro-icon', size: 78 },
	{ name: 'Docker', icon: 'logos:docker-icon', size: 100 },
	{ name: 'Spring', icon: 'logos:spring-icon', size: 86 },
	{ name: 'Claude', icon: 'logos:claude-icon', size: 90 },
	{ name: 'Java', icon: 'logos:java', size: 92 },
] as const;

export const NOMBRES = TECHS.map((t) => t.name) as [string, ...string[]];

const PORNOMBRE = new Map(TECHS.map((t) => [t.name as string, t.icon as string]));

export const iconoDe = (nombre: string): string => PORNOMBRE.get(nombre) ?? 'logos:javascript';

/**
 * El nombre que empareja el montón de etiquetas entre la lista y la entrada.
 *
 * Lleva el slug porque en la lista hay un montón por entrada: sin él habría
 * varios elementos con el mismo nombre en la misma página, y eso no es que
 * empareje mal, es que el navegador se salta la transición entera.
 *
 * Y se limpia lo que no vale como identificador.
 */
export const nombreDeTransicion = (slug: string): string =>
	`t-${slug.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
