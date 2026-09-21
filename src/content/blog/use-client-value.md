---
title: 'Prehydrating React state without a server-to-client key'
description: 'An inline script can correct the DOM before the first paint. Generalising that into a React hook needs a key the server and the client derive identically, and every way of deriving one from the source fails under separate minification.'
date: 2026-09-21
techs: [React, TypeScript]
---

## One frame of the wrong value

Anything the server cannot know, such as the time, the theme, or a flag in
`sessionStorage`, renders with a placeholder and gets corrected on hydration. The
correction lands after the first paint, so the wrong value occupies at least one
frame. Ethan Niser named that a <span role="button" tabindex="0" data-more data-sound-hover style="--more-color: #F97316" aria-expanded="false" class="more"><span data-more-short>snap</span><span data-more-full>snap, and at 60Hz one frame is 16ms, long enough to notice and too short for anyone to go profiling</span></span>.

<figure data-ancho>
<div><video src="/blog/flicker.mp4" poster="/blog/flicker-poster.png" autoplay loop muted playsinline preload="auto" width="464" height="240" aria-describedby="cap-video"></video></div>
<figcaption id="cap-video">Both blocks read the same session flag and both end up correct. The top one is what you would write today, and it ships <code>Sign in</code> until React hydrates. The bottom one is the hook this article is about. Production build, CPU throttled 10x.</figcaption>
</figure>

On a fast laptop the window is around 14ms, which is short enough to survive
review. Throttling the CPU makes it measurable.

## What does not generalise

The fix Niser describes in
[a clock that doesn't snap](https://ethanniser.com/blog/a-clock-that-doesnt-snap)
has four pieces. An inline `<script>` goes immediately after the element it
affects. The parser reaches it long before React hydrates, and it patches the DOM
with the real value. It then leaves that value in a global,
`window.__INITIAL_TIME__`. React reads the global from the `useState` initialiser.

Those last two pieces are what avoid a <span role="button" tabindex="0" data-more data-sound-hover style="--more-color: #F97316" aria-expanded="false" class="more"><span data-more-short>hydration mismatch</span><span data-more-full>hydration mismatch, which is React picking up the server's markup, finding it does not match what it just rendered on the client, and saying so in development</span></span>, and they are also the
ones that do not survive the trip. They work because one person picked
`__INITIAL_TIME__` by hand, for one value, in one component.
[Suamox](https://github.com/calumet/suamox) packages this as `useClientValue`,
where a page has as many invocations as it has calls, and every one of them needs
a key that the server and the client derive the same way.

## Deriving a key both sides compute

`useId()` looks like the answer, since React already hands out identifiers that
are stable across server and client. The logs said otherwise, reading `_R_3_`
during hydration and `_r_0_` on a later render. The router remounts the tree
instead of re-rendering it, and a positional id changes between mounts, so one
client-side navigation was enough for the precomputed value to stop being found.

If a positional id will not do, derive the key from the content instead.
`resolve.toString()`, hashed. It survives remounting and it ignores position in
the tree. It passed the unit tests. It passed the end-to-end tests. It was broken
in production.

```
SSR bundle:     getItem("idUsr")   ->  cv86gbue
client bundle:  getItem(`idUsr`)   ->  cv14jxbdi
```

The minifier rewrites the body of the function, and there are two bundles,
minified separately and with separate decisions. That is how the double quotes
became backticks on one side and stayed put on the other. Two hashes, no match,
and React silently falls back to the server value.

Three things kept it hidden:

- The inline script still patched the DOM correctly, so the screen looked right.
- React does not report hydration mismatches in production builds.
- The end-to-end tests asserted on the DOM and never on React's state, which made
  them green while testing nothing.

None of that is an implementation bug. Any key derived from the source of
`resolve` is fragile by construction, because the string being hashed is
serialised from one bundle and compared against another. The original never runs
into it. Its script is written by hand, in the same file, under a global whose
name is fixed.

## Removing the key entirely

The fix was to drop the last two pieces. The value stops travelling from the
script to React:

```ts
const noSubscribe = () => () => {};

return useSyncExternalStore(noSubscribe, resolve, () => fallback);
```

The server returns `fallback` through <span role="button" tabindex="0" data-more data-sound-hover style="--more-color: #F97316" aria-expanded="false" class="more"><span data-more-short><code>getServerSnapshot</code></span><span data-more-full><code>getServerSnapshot</code>, the third argument of <code>useSyncExternalStore</code>, which React calls on the server and then once more on the client for the hydration render, so both sides start from the same value</span></span>. The client runs
`resolve` on its own, in its own bundle. The inline script no longer carries
anything, it just moves the DOM correction ahead of the first paint.

With nothing to match, the key, the hash and `window.__PREHYDRATE__` all go away,
and with that last global goes one way in for <span role="button" tabindex="0" data-more data-sound-hover style="--more-color: #F97316" aria-expanded="false" class="more"><span data-more-short>DOM clobbering</span><span data-more-full>DOM clobbering, where a <code>&lt;div id="X"&gt;</code> anywhere in the page creates <code>window.X</code> and quietly stands in for whatever the framework stored under that name</span></span>.

A script that fails now costs a flicker instead of a wrong value. A CSP that
blocks inline scripts, a client-only route, a `resolve` that closes over something
from the component scope: every one of those degrades rather than breaking.

### What suppressHydrationWarning costs

Patched elements now disagree with React during hydration. React never sees the
server's HTML again; what it compares against is its own first render, the one
`useSyncExternalStore` builds from `getServerSnapshot` so that it reproduces the
server. It walks the already-corrected DOM, finds that render does not match, and
prints the diff:

```
<button id="btn-logout"
+   hidden={true}    what React renders while hydrating
-   hidden={null}    what the script already put in the DOM
```

`suppressHydrationWarning` on those elements silences it, and it is not part of
the hook's API. It is not required either. Leave it off and the value still ends
up correct, because the store re-renders the moment `getSnapshot` disagrees with
`getServerSnapshot`.

The DOM cannot settle that, since the script patches it either way. Ask React
instead, through a value it renders and a render forced after hydration, and the
unmarked elements come out identical to the marked ones. `won't be patched up`
covers the hydration pass, not the node itself. What the attribute costs is one
console error in development and nothing in production.

The framework cannot add it for you. React reads `suppressHydrationWarning` off
the element's props and not off the DOM, where an inline script setting the
attribute changes nothing in any of the four spellings worth trying. Only
whoever writes the JSX can put it there.

That same re-render also covers anything outside `patch`. A `<p>` whose text
depends on the value is never touched by the script, so it ships with `fallback`
and React corrects it on the re-render, which is late by definition. Measured at
6x throttling, the patched button corrects at 192ms and the first paint lands at
196ms, while the text does not move until 620ms.

```tsx
// Correct after 620ms, so wrong for 424 of them.
<p>{isLoggedIn ? 'inside' : 'outside'}</p>
```

So the rule holds. Everything that depends on the value goes through `patch`,
because whatever stays outside it flickers.

## Measuring the window

<figure data-ancho>
<div><img src="/blog/flicker-window.svg" alt="Four rows, one per CPU throttle level. In every row the useClientValue correction falls to the left of first paint, and a dithered bar runs from first paint to the moment useSyncExternalStore corrects: 14ms at 1x, 58ms at 4x, 136ms at 6x and 205ms at 10x." width="620" height="200"></div>
<figcaption>Medians over five loads at 1x, 4x and 6x, and ten at 10x, taken from the production build with Playwright and <code>Emulation.setCPUThrottlingRate</code>. Exact milliseconds move between runs and between pages. The shape does not.</figcaption>
</figure>

The bar is the interval where the wrong value is on screen. The hook does not
shorten it, it removes it, because the correction happens while the parser is
still working through the body.

That holds up to a point. The script sits at the end of `<body>`, and at 20x,
three loads out of ten painted before the parser reached it. The result is the
failure the design was built for, a flicker rather than a wrong value, so nothing
breaks. But the ordering is not guaranteed above 10x on this page.

## The API

```ts
useClientValue<T>(
  fallback: T,
  resolve: () => T,
  patch?: { show?: string; hide?: string } | ((value: T) => void),
): T
```

```tsx
const isLoggedIn = useClientValue(
  false,
  () => !!sessionStorage.getItem('idUsr'),
  { show: '#btn-logout', hide: '#btn-login' },
);

<button id="btn-logout" hidden={!isLoggedIn}>Sign out</button>
<a id="btn-login" hidden={isLoggedIn}>Sign in</a>
```

`hidden` is doing real work there. An earlier draft used a `data-cv-hide`
attribute with a stylesheet the framework injected into every page, and it forced
this on anyone writing a component:

```tsx
<button data-cv-hide={!isLoggedIn || undefined}>
```

React serialises `data-*` attributes by value, so `data-cv-hide={false}` reaches
the HTML as the string `"false"`, and a `[data-cv-hide]` selector matches any
value, that one included. The button would hide unconditionally, and that
`|| undefined` exists for no reason other than forcing React to omit the
attribute. React knows `hidden` as a boolean attribute and omits it on `false` by
itself, and the global stylesheet goes away with it.

The catch is that `hidden` loses to any rule setting `display` on the element,
which plenty of CSS frameworks do. Restyling the demo to record the clip above
was enough to trigger it, with one `display: inline-block` on the buttons making
both of them show at once. The fix is a line, and only the pages that need it pay
for it.

```css
[hidden] { display: none !important; }
```

`resolve` carries most of the restrictions. It is used two ways, and only one of
them constrains what you can write. React calls it like any other client function.
The inline script serialises it with `toString()`, and that copy runs with no
imports, no component variables, no module constants and no `.bind()`. It also
ends up in public HTML, so nothing secret goes in it.

## What generalising changes

The original works, and it keeps working for the case it was written for. Two
things change on the way to a framework.

A key derived from the source of a function cannot survive two bundles minified
separately, which rules out the solution that looks most obvious. And letting the
client recompute with `useSyncExternalStore`, while demoting the inline script to
a paint-time optimisation, turns every failure into a flicker rather than a wrong
value. That leaves the flicker as the only thing left to account for, and it is
not confined to the elements listed in `patch`.
