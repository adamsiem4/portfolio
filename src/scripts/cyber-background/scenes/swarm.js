// Data swarm: ragged streaks of tiles drift along a slow flow field. Each cluster
// is a chain of metaball nodes trailing behind its head with a swimming wave; the
// chain periodically stretches so its tail tears off into separate fragments and
// pulls back together. Nodes flee the pointer and are thrown outward by splashes.

const TAU = Math.PI * 2;
const NODE_SPRING = 3;
const NODE_DAMPING = 2.6;
const NODE_REACH = 2.2;
const POINTER_PUSH = 70;
const SPLASH_RADIUS = 14;
const SPLASH_PUSH = 22;
const RING_SPEED = 22;
const RING_LIFE = 0.6;
const RING_WIDTH = 1.6;
const DUST_DENSITY = 0.005;
// Scales every autonomous rhythm (flow, wobble, stretching, edge drift) without
// slowing the reactions to the pointer and splashes.
const TEMPO = 0.5;

const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);
const between = (minimum, maximum) => minimum + Math.random() * (maximum - minimum);
const smoothstep = (edge0, edge1, value) => {
	const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
	return t * t * (3 - 2 * t);
};

// Layered sines: smooth, cheap, and slowly evolving without a noise table.
const flowAngle = (x, y, time) =>
	Math.sin(x * 0.045 + time * 0.07) * 1.6
	+ Math.cos(y * 0.06 - time * 0.05) * 1.3
	+ Math.sin((x - y) * 0.025 + time * 0.03) * 1.1;

const createCluster = (x, y) => {
	const nodeCount = 5 + Math.floor(Math.random() * 3);

	return {
		x,
		y,
		vx: 0,
		vy: 0,
		headingX: 1,
		headingY: 0,
		phase: Math.random() * TAU,
		splitRate: between(0.05, 0.1),
		nodes: Array.from({ length: nodeCount }, (_, index) => {
			// 0 at the head, 1 at the tip of the tail.
			const trail = index / (nodeCount - 1);
			return {
				trail,
				lateral: between(-1, 1),
				wobble: between(0.4, 0.9),
				size: between(0.45, 0.7) * (1 - 0.45 * trail),
				x,
				y,
				vx: 0,
				vy: 0,
			};
		}),
	};
};

export const createSwarmScene = () => {
	let cols = 0;
	let rows = 0;
	let time = 0;
	let radius = 1;
	let speed = 1;
	let pointer = null;
	let field = new Float32Array(0);
	let jitter = new Float32Array(0);
	let dust = [];
	const clusters = [];
	const rings = [];

	const push = (body, dx, dy, distance, strength) => {
		if (distance < 1e-3) return;
		body.vx += (dx / distance) * strength;
		body.vy += (dy / distance) * strength;
	};

	const resize = (nextCols, nextRows, { compact }) => {
		const scaleX = cols ? nextCols / cols : 1;
		const scaleY = rows ? nextRows / rows : 1;
		clusters.forEach((cluster) => {
			cluster.x *= scaleX;
			cluster.y *= scaleY;
			cluster.nodes.forEach((node) => {
				node.x *= scaleX;
				node.y *= scaleY;
			});
		});

		cols = nextCols;
		rows = nextRows;
		radius = Math.min(cols, rows) * (compact ? 0.16 : 0.1);
		speed = (compact ? 1.1 : 1.4) * TEMPO;

		const area = cols * rows;
		const count = compact
			? clamp(Math.round(area / 900), 2, 3)
			: clamp(Math.round(area / 2400), 3, 5);
		clusters.length = Math.min(clusters.length, count);
		while (clusters.length < count) {
			clusters.push(createCluster(between(radius, cols - radius), between(radius, rows - radius)));
		}

		field = new Float32Array(area);
		jitter = Float32Array.from({ length: area }, () => between(0.65, 1.35));
		dust = [];
		for (let index = 0; index < area; index += 1) {
			if (Math.random() < DUST_DENSITY) dust.push({ index, phase: Math.random() * TAU });
		}
	};

	const step = (dt, nextPointer) => {
		time += dt * TEMPO;
		pointer = nextPointer;
		const follow = Math.min(1, 0.8 * dt);

		clusters.forEach((cluster) => {
			const angle = flowAngle(cluster.x, cluster.y, time);
			cluster.vx += (Math.cos(angle) * speed - cluster.vx) * follow;
			cluster.vy += (Math.sin(angle) * speed - cluster.vy) * follow;

			// Soft walls keep every cluster on screen.
			if (cluster.x < radius) cluster.vx += (radius - cluster.x) * 0.6 * dt;
			if (cluster.x > cols - radius) cluster.vx -= (cluster.x - cols + radius) * 0.6 * dt;
			if (cluster.y < radius) cluster.vy += (radius - cluster.y) * 0.6 * dt;
			if (cluster.y > rows - radius) cluster.vy -= (cluster.y - rows + radius) * 0.6 * dt;

			clusters.forEach((other) => {
				if (other === cluster) return;
				const dx = cluster.x - other.x;
				const dy = cluster.y - other.y;
				const distance = Math.hypot(dx, dy);
				const reach = radius * 2.2;
				if (distance < reach) push(cluster, dx, dy, distance, (1 - distance / reach) * 0.5 * dt);
			});

			if (pointer) {
				const dx = cluster.x - pointer.x;
				const dy = cluster.y - pointer.y;
				const distance = Math.hypot(dx, dy);
				const reach = pointer.radius * 1.5;
				if (distance < reach) push(cluster, dx, dy, distance, 8 * (1 - distance / reach) ** 2 * dt);
			}

			cluster.x += cluster.vx * dt;
			cluster.y += cluster.vy * dt;

			// Smoothed heading, so pointer shoves bend the streak instead of flipping it.
			const velocity = Math.hypot(cluster.vx, cluster.vy);
			if (velocity > 1e-3) {
				const turn = Math.min(1, 1.5 * dt);
				cluster.headingX += (cluster.vx / velocity - cluster.headingX) * turn;
				cluster.headingY += (cluster.vy / velocity - cluster.headingY) * turn;
				const heading = Math.hypot(cluster.headingX, cluster.headingY) || 1;
				cluster.headingX /= heading;
				cluster.headingY /= heading;
			}

			const stretch = 0.6 + 0.9 * (0.5 + 0.5 * Math.sin(time * cluster.splitRate * TAU + cluster.phase));
			cluster.nodes.forEach((node) => {
				const along = node.trail * radius * 2.6 * stretch;
				const side = radius * (
					node.lateral * 0.6 * (0.6 + 0.4 * Math.sin(time * node.wobble + cluster.phase))
					+ Math.sin(time * 1.2 - node.trail * 4 + cluster.phase) * 0.35 * node.trail
				);
				const targetX = cluster.x - cluster.headingX * along - cluster.headingY * side;
				const targetY = cluster.y - cluster.headingY * along + cluster.headingX * side;
				node.vx += ((targetX - node.x) * NODE_SPRING - node.vx * NODE_DAMPING) * dt;
				node.vy += ((targetY - node.y) * NODE_SPRING - node.vy * NODE_DAMPING) * dt;

				if (pointer) {
					const dx = node.x - pointer.x;
					const dy = node.y - pointer.y;
					const distance = Math.hypot(dx, dy);
					if (distance < pointer.radius) {
						push(node, dx, dy, distance, POINTER_PUSH * (1 - distance / pointer.radius) ** 2 * dt);
					}
				}

				node.x += node.vx * dt;
				node.y += node.vy * dt;
			});
		});

		for (let index = rings.length - 1; index >= 0; index -= 1) {
			rings[index].age += dt;
			if (rings[index].age > RING_LIFE) rings.splice(index, 1);
		}
	};

	const splash = (x, y) => {
		rings.push({ x, y, age: 0 });
		clusters.forEach((cluster) => {
			const distance = Math.hypot(cluster.x - x, cluster.y - y);
			if (distance < SPLASH_RADIUS) {
				push(cluster, cluster.x - x, cluster.y - y, distance, 3 * (1 - distance / SPLASH_RADIUS));
			}
			cluster.nodes.forEach((node) => {
				const nodeDistance = Math.hypot(node.x - x, node.y - y);
				if (nodeDistance < SPLASH_RADIUS) {
					push(node, node.x - x, node.y - y, nodeDistance, SPLASH_PUSH * (1 - nodeDistance / SPLASH_RADIUS));
				}
			});
		});
	};

	// Visits every cell whose centre lies within `reach` of (x, y).
	const forCellsNear = (x, y, reach, visit) => {
		const top = Math.max(0, Math.floor(y - reach));
		const bottom = Math.min(rows - 1, Math.ceil(y + reach));
		const left = Math.max(0, Math.floor(x - reach));
		const right = Math.min(cols - 1, Math.ceil(x + reach));
		for (let row = top; row <= bottom; row += 1) {
			const dy = row + 0.5 - y;
			for (let col = left; col <= right; col += 1) {
				const dx = col + 0.5 - x;
				const distanceSquared = dx * dx + dy * dy;
				if (distanceSquared < reach * reach) visit(row * cols + col, distanceSquared);
			}
		}
	};

	const fill = ({ intensity, heat }) => {
		field.fill(0);
		clusters.forEach((cluster) => {
			cluster.nodes.forEach((node) => {
				const reach = node.size * radius * NODE_REACH;
				const reachSquared = reach * reach;
				// Compact-support metaball kernel: overlapping nodes merge smoothly.
				forCellsNear(node.x, node.y, reach, (index, distanceSquared) => {
					const falloff = 1 - distanceSquared / reachSquared;
					field[index] += falloff * falloff * falloff;
				});
			});
		});

		for (let index = 0; index < field.length; index += 1) {
			if (field[index] === 0) continue;
			// Per-cell jitter dithers the edges; a drifting interference pattern tears
			// them into ragged, blocky fringes.
			const col = index % cols;
			const row = (index - col) / cols;
			const rough = Math.sin(col * 0.9 + row * 0.3 + time * 0.7) * Math.sin(row * 1.1 - time * 0.5);
			intensity[index] = smoothstep(0.2, 0.85, field[index] * jitter[index] * (1 + 0.3 * rough));
		}

		dust.forEach(({ index, phase }) => {
			intensity[index] = Math.max(intensity[index], 0.1 * Math.max(0, Math.sin(time * 0.5 + phase)));
		});

		if (pointer) {
			forCellsNear(pointer.x, pointer.y, pointer.radius, (index, distanceSquared) => {
				if (intensity[index] === 0) return;
				const proximity = 1 - Math.sqrt(distanceSquared) / pointer.radius;
				heat[index] = Math.max(heat[index], proximity * proximity);
			});
		}

		rings.forEach((ring) => {
			const ringRadius = ring.age * RING_SPEED;
			const fade = 1 - ring.age / RING_LIFE;
			forCellsNear(ring.x, ring.y, ringRadius + RING_WIDTH, (index, distanceSquared) => {
				const profile = (1 - Math.abs(Math.sqrt(distanceSquared) - ringRadius) / RING_WIDTH) * fade;
				if (profile <= 0) return;
				intensity[index] = Math.max(intensity[index], profile * 0.8);
				heat[index] = Math.max(heat[index], profile);
			});
		});
	};

	return { resize, step, splash, fill };
};
