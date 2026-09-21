import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { NOMBRES } from './lib/techs';

const blog = defineCollection({
	loader: glob({ base: './src/content/blog', pattern: '**/*.md' }),
	schema: z.object({
		title: z.string(),
		description: z.string(),
		date: z.coerce.date(),
		// Contra la lista de verdad: un nombre mal escrito rompe el build.
		techs: z.array(z.enum(NOMBRES)).default([]),
	}),
});

export const collections = { blog };
