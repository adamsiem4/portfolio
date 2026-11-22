// Glyph presets turn scene intensity (0..1) into characters, independently of the
// scene. `ramp` runs from faint to dense along soft edges; cells at or above
// `coreFrom` draw from `core`. `scramble` is the chance per cell per second that a
// cell re-rolls its glyph, so dense regions read as live data. `tiles` draws a
// shaded square behind every glyph and knocks dense glyphs out of it.
export const glyphPresets = {
	// Every printable ASCII character from ! to ~.
	ascii: {
		ramp: '.:-=+*#',
		core: Array.from({ length: 94 }, (_, index) => String.fromCharCode(33 + index)).join(''),
		coreFrom: 0.7,
		scramble: 0.18,
		tiles: false,
	},
	hex: { ramp: '.:-=+*#', core: '0123456789ABCDEF', coreFrom: 0.7, scramble: 0.35, tiles: true },
	binary: { ramp: '.:', core: '01', coreFrom: 0.4, scramble: 0.5, tiles: true },
	ramp: { ramp: '.:-=+*#%', core: '@', coreFrom: 0.92, scramble: 0, tiles: false },
	box: { ramp: '·┈┄─', core: '┼╋╬', coreFrom: 0.6, scramble: 0.2, tiles: false },
};
