import { createSwarmScene } from './swarm.js';

// Scene contract. All coordinates are in grid cells; scenes never touch the canvas.
//   resize(cols, rows, { compact }) - grid changed; `compact` marks the mobile profile.
//   step(dt, pointer)               - advance by dt seconds; pointer is
//                                     { x, y, radius } or null when inactive.
//   splash(x, y)                    - a click landed on the background.
//   fill(cells)                     - write cells.intensity and cells.heat (both
//                                     Float32Array, cols * rows, zeroed, 0..1).
// Heat drives the accent colour and faster glyph scrambling in the core.
export const scenes = {
	swarm: createSwarmScene,
};
