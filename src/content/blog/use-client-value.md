---
title: 'useClientValue: a hook that does not snap'
description: 'Server-rendered markup and the client disagree for one frame, and that frame is visible. What Suamox does about it.'
date: 2026-09-21
techs: [React, TypeScript]
---

> Draft. Structure first, prose after.

## The frame nobody looks at

Anything the server cannot know — the time, the theme, a preference in
`localStorage` — gets rendered wrong once and corrected on hydration. The
correction lands after the first paint, so it is not a value changing: it is a
value *snapping*. Ethan Niser wrote it up in
[a clock that doesn't snap](https://ethanniser.com/blog/a-clock-that-doesnt-snap).

## What Suamox does

<!-- TODO: la API de useClientValue, y por qué esa y no otra -->

## What it costs

<!-- TODO -->
