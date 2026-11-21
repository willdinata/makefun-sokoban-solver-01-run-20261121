const fs = require('node:fs');
const path = require('node:path');

// Direction order is also the tie-break order for floods, walks, and pushes.
const WALK = 'udlr';
const PUSH = 'UDLR';
const OPPOSITE = [1, 0, 3, 2];
const EXPANSION_CAP = 2_000_000;

function parseLevel(text) {
  const rows = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  while (rows.length && rows[rows.length - 1] === '') rows.pop();
  let width = 0;
  for (const row of rows) width = Math.max(width, row.length);
  const size = width * rows.length;
  if (!size) throw new Error('Empty level');

  const floor = new Uint8Array(size);
  const goalMask = new Uint8Array(size);
  const cells = [];
  const goals = [];
  const boxes = [];
  let player = -1;
  for (let y = 0; y < rows.length; y++) {
    // Unspecified cells in a ragged row remain walls.
    for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x];
      if (!' .$*@+'.includes(ch)) continue;
      const cell = y * width + x;
      floor[cell] = 1;
      cells.push(cell);
      if (ch === '.' || ch === '*' || ch === '+') {
        goalMask[cell] = 1;
        goals.push(cell);
      }
      if (ch === '$' || ch === '*') boxes.push(cell);
      if (ch === '@' || ch === '+') {
        if (player !== -1) throw new Error('Multiple players');
        player = cell;
      }
    }
  }
  if (player === -1) throw new Error('Missing player');

  const neighbors = new Int32Array(size * 4).fill(-1);
  for (const cell of cells) {
    const x = cell % width;
    const y = Math.floor(cell / width);
    if (y > 0 && floor[cell - width]) neighbors[cell * 4] = cell - width;
    if (y + 1 < rows.length && floor[cell + width]) neighbors[cell * 4 + 1] = cell + width;
    if (x > 0 && floor[cell - 1]) neighbors[cell * 4 + 2] = cell - 1;
    if (x + 1 < width && floor[cell + 1]) neighbors[cell * 4 + 3] = cell + 1;
  }
  return { width, size, floor, goalMask, cells, goals, boxes, player, neighbors };
}

function decompose(board) {
  const hallwayRow = Math.floor(board.player / board.width);
  const doorMask = new Uint8Array(board.size);
  const doors = [];
  for (const y of [hallwayRow - 1, hallwayRow + 1]) {
    if (y < 0 || y * board.width >= board.size) continue;
    for (let x = 0; x < board.width; x++) {
      const cell = y * board.width + x;
      if (board.floor[cell]) {
        doorMask[cell] = 1;
        doors.push(cell);
      }
    }
  }
  if (!doors.length) return null;

  const componentOf = new Int32Array(board.size).fill(-1);
  const components = [];
  const queue = new Int32Array(board.size);
  for (const start of board.cells) {
    if (doorMask[start] || componentOf[start] !== -1) continue;
    const id = components.length;
    const cells = [];
    let head = 0;
    let tail = 1;
    queue[0] = start;
    componentOf[start] = id;
    while (head < tail) {
      const cell = queue[head++];
      cells.push(cell);
      for (let d = 0; d < 4; d++) {
        const next = board.neighbors[cell * 4 + d];
        if (next < 0 || doorMask[next] || componentOf[next] !== -1) continue;
        componentOf[next] = id;
        queue[tail++] = next;
      }
    }
    cells.sort((a, b) => a - b);
    components.push(cells);
  }

  const hallway = componentOf[board.player];
  if (hallway < 0) return null;
  if (components[hallway].some(cell => Math.floor(cell / board.width) !== hallwayRow)) return null;
  const rooms = [];
  const roomOfComponent = new Map();
  for (let id = 0; id < components.length; id++) {
    if (id === hallway) continue;
    const room = { cells: components[id].slice(), door: -1, entry: -1, boxes: [], goals: [] };
    rooms.push(room);
    roomOfComponent.set(id, room);
  }
  if (!rooms.length) return null;

  for (const door of doors) {
    let entry = -1;
    let roomId = -1;
    for (let d = 0; d < 4; d++) {
      const next = board.neighbors[door * 4 + d];
      if (next < 0) continue;
      if (doorMask[next]) return null;
      const id = componentOf[next];
      if (id === hallway) {
        if (entry !== -1) return null;
        entry = next;
      } else {
        if (id < 0 || (roomId !== -1 && roomId !== id)) return null;
        roomId = id;
      }
    }
    const room = roomOfComponent.get(roomId);
    if (entry < 0 || !room || room.door !== -1) return null;
    if (entry !== hallwayRow * board.width + door % board.width) return null;
    room.door = door;
    room.entry = entry;
    room.cells.push(door);
    room.cells.sort((a, b) => a - b);
  }
  if (rooms.some(room => room.door < 0)) return null;
  rooms.sort((a, b) => a.cells[0] - b.cells[0]);

  const owner = new Int32Array(board.size).fill(-1);
  for (let id = 0; id < rooms.length; id++) {
    for (const cell of rooms[id].cells) owner[cell] = id;
  }
  // Door cells belong to the room even when they initially contain a box.
  for (const box of board.boxes) {
    if (owner[box] < 0) return null;
    rooms[owner[box]].boxes.push(box);
  }
  for (const goal of board.goals) {
    if (owner[goal] < 0) return null;
    rooms[owner[goal]].goals.push(goal);
  }
  if (rooms.some(room => room.boxes.length !== room.goals.length)) return null;
  return rooms;
}

class MinHeap {
  constructor(compare) {
    this.items = [];
    this.compare = compare;
  }

  push(value) {
    let index = this.items.length;
    this.items.push(value);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.compare(this.items[parent], value) <= 0) break;
      this.items[index] = this.items[parent];
      index = parent;
    }
    this.items[index] = value;
  }

  pop() {
    const first = this.items[0];
    const last = this.items.pop();
    if (this.items.length) {
      let index = 0;
      while (index * 2 + 1 < this.items.length) {
        let child = index * 2 + 1;
        if (child + 1 < this.items.length && this.compare(this.items[child + 1], this.items[child]) < 0) child++;
        if (this.compare(last, this.items[child]) <= 0) break;
        this.items[index] = this.items[child];
        index = child;
      }
      this.items[index] = last;
    }
    return first;
  }
}

function goalPermutations(count) {
  const permutations = [];
  const chosen = [];
  const used = new Uint8Array(count);
  function visit() {
    if (chosen.length === count) {
      permutations.push(chosen.slice());
      return;
    }
    for (let goal = 0; goal < count; goal++) {
      if (used[goal]) continue;
      used[goal] = 1;
      chosen.push(goal);
      visit();
      chosen.pop();
      used[goal] = 0;
    }
  }
  visit();
  return permutations;
}

// Larger whole-board fallbacks still use exact minimum-cost matching, without
// materializing factorially many permutations. Rows are boxes, columns goals.
function largeMatching(boxes, distances, size) {
  const n = boxes.length;
  const m = distances.length;
  if (n > m) return Infinity;
  const penalty = (size + 1) * (n + 1);
  const u = new Float64Array(n + 1);
  const v = new Float64Array(m + 1);
  const matched = new Int32Array(m + 1);
  const way = new Int32Array(m + 1);
  const minimum = new Float64Array(m + 1);
  const used = new Uint8Array(m + 1);
  for (let i = 1; i <= n; i++) {
    matched[0] = i;
    minimum.fill(Infinity);
    used.fill(0);
    let column = 0;
    do {
      used[column] = 1;
      const row = matched[column];
      let delta = Infinity;
      let nextColumn = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const distance = distances[j - 1][boxes[row - 1]];
        const cost = (distance < 0 ? penalty : distance) - u[row] - v[j];
        if (cost < minimum[j]) {
          minimum[j] = cost;
          way[j] = column;
        }
        if (minimum[j] < delta) {
          delta = minimum[j];
          nextColumn = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[matched[j]] += delta;
          v[j] -= delta;
        } else {
          minimum[j] -= delta;
        }
      }
      column = nextColumn;
    } while (matched[column] !== 0);
    do {
      const previous = way[column];
      matched[column] = matched[previous];
      column = previous;
    } while (column !== 0);
  }
  let total = 0;
  for (let j = 1; j <= m; j++) {
    if (!matched[j]) continue;
    const distance = distances[j - 1][boxes[matched[j] - 1]];
    if (distance < 0) return Infinity;
    total += distance;
  }
  return total;
}

function shortestWalk(board, walkable, occupied, start, target) {
  if (start < 0 || target < 0 || !walkable[start] || !walkable[target] || occupied[start] || occupied[target]) return null;
  if (start === target) return '';
  const previous = new Int32Array(board.size).fill(-1);
  const direction = new Uint8Array(board.size);
  const queue = new Int32Array(board.size);
  let head = 0;
  let tail = 1;
  queue[0] = start;
  previous[start] = start;
  while (head < tail && previous[target] === -1) {
    const cell = queue[head++];
    for (let d = 0; d < 4; d++) {
      const next = board.neighbors[cell * 4 + d];
      if (next < 0 || !walkable[next] || occupied[next] || previous[next] !== -1) continue;
      previous[next] = cell;
      direction[next] = d;
      queue[tail++] = next;
      if (next === target) break;
    }
  }
  if (previous[target] === -1) return null;
  const moves = [];
  for (let cell = target; cell !== start; cell = previous[cell]) moves.push(WALK[direction[cell]]);
  return moves.reverse().join('');
}

function solvePushes(board, { cells, boxes, goals, start, entry = -1, door = -1 }) {
  const region = new Uint8Array(board.size);
  for (const cell of cells) {
    if (!board.floor[cell]) return null;
    region[cell] = 1;
  }
  const walkable = region.slice();
  if (entry >= 0) {
    if (!board.floor[entry] || region[entry]) return null;
    walkable[entry] = 1;
  }
  const initialBoxes = boxes.slice().sort((a, b) => a - b);
  const sortedGoals = goals.slice().sort((a, b) => a - b);
  if (initialBoxes.length > sortedGoals.length) return null;
  const goalMask = new Uint8Array(board.size);
  for (const goal of sortedGoals) {
    if (!region[goal] || !board.goalMask[goal]) return null;
    goalMask[goal] = 1;
  }
  const occupied = new Uint8Array(board.size);
  for (const box of initialBoxes) {
    if (!region[box] || occupied[box]) return null;
    occupied[box] = 1;
  }
  if (!walkable[start] || occupied[start]) return null;

  const queue = new Int32Array(board.size);
  const live = new Uint8Array(board.size);
  const distances = [];
  for (const goal of sortedGoals) {
    const distance = new Int32Array(board.size).fill(-1);
    distance[goal] = 0;
    live[goal] = 1;
    let head = 0;
    let tail = 1;
    queue[0] = goal;
    while (head < tail) {
      const target = queue[head++];
      for (let d = 0; d < 4; d++) {
        const source = board.neighbors[target * 4 + OPPOSITE[d]];
        if (source < 0 || !region[source] || distance[source] !== -1) continue;
        const stand = board.neighbors[source * 4 + OPPOSITE[d]];
        // A box may start on the door, with its pusher standing on E. Only
        // the stand cell may be E; both box cells must remain inside R.
        if (stand < 0 || !walkable[stand]) continue;
        distance[source] = distance[target] + 1;
        live[source] = 1;
        queue[tail++] = source;
      }
    }
    distances.push(distance);
  }
  if (initialBoxes.some(box => !live[box] && !goalMask[box])) return null;

  const permutations = initialBoxes.length === sortedGoals.length && sortedGoals.length <= 4
    ? goalPermutations(sortedGoals.length) : null;
  const heuristicCache = new Map();
  function heuristic(currentBoxes, boxKey) {
    if (heuristicCache.has(boxKey)) return heuristicCache.get(boxKey);
    let best = Infinity;
    if (permutations) {
      for (const permutation of permutations) {
        let cost = 0;
        for (let i = 0; i < currentBoxes.length; i++) {
          const distance = distances[permutation[i]][currentBoxes[i]];
          if (distance < 0) {
            cost = Infinity;
            break;
          }
          cost += distance;
          if (cost >= best) break;
        }
        if (cost < best) best = cost;
      }
    } else {
      best = largeMatching(currentBoxes, distances, board.size);
    }
    heuristicCache.set(boxKey, best);
    return best;
  }

  const seen = new Uint32Array(board.size);
  const reachable = new Uint8Array(board.size);
  let stamp = 0;
  function flood(player, capture = false) {
    if (capture) reachable.fill(0);
    if (!walkable[player] || occupied[player]) return -1;
    if (stamp === 0xffffffff) {
      seen.fill(0);
      stamp = 0;
    }
    stamp++;
    let canonical = player;
    let head = 0;
    let tail = 1;
    queue[0] = player;
    seen[player] = stamp;
    if (capture) reachable[player] = 1;
    while (head < tail) {
      const cell = queue[head++];
      if (cell < canonical) canonical = cell;
      for (let d = 0; d < 4; d++) {
        const next = board.neighbors[cell * 4 + d];
        if (next < 0 || !walkable[next] || occupied[next] || seen[next] === stamp) continue;
        seen[next] = stamp;
        if (capture) reachable[next] = 1;
        queue[tail++] = next;
      }
    }
    return canonical;
  }

  const firstBoxKey = initialBoxes.join(',');
  const firstH = heuristic(initialBoxes, firstBoxKey);
  if (!Number.isFinite(firstH)) return null;
  const firstCanonical = flood(start);
  const firstKey = `${firstBoxKey}:${firstCanonical}`;
  const nodes = [{ id: 0, boxes: initialBoxes, player: start, canonical: firstCanonical,
    key: firstKey, g: 0, h: firstH, f: firstH, parent: -1, box: -1, direction: -1 }];
  const bestState = new Map([[firstKey, 0]]);
  const heap = new MinHeap((a, b) => {
    const left = nodes[a];
    const right = nodes[b];
    return left.f - right.f || left.h - right.h || left.id - right.id;
  });
  heap.push(0);
  let expansions = 0;
  let optimalCost = Infinity;
  let chosenGoal = -1;
  let allowsExit = false;

  while (heap.items.length) {
    const id = heap.pop();
    const node = nodes[id];
    if (bestState.get(node.key) !== id) continue;
    // Once a goal establishes P*, only states with f <= P* can supply an
    // alternative optimal goal whose reachable region contains the door.
    if (node.f > optimalCost) break;
    occupied.fill(0);
    for (const box of node.boxes) occupied[box] = 1;
    flood(node.player, true);
    if (node.boxes.every(box => goalMask[box])) {
      if (chosenGoal === -1) {
        chosenGoal = id;
        optimalCost = node.g;
      }
      if (door < 0 || reachable[door]) {
        chosenGoal = id;
        allowsExit = true;
        break;
      }
      continue;
    }
    if (expansions >= EXPANSION_CAP) break;
    expansions++;

    for (let i = 0; i < node.boxes.length; i++) {
      const box = node.boxes[i];
      for (let d = 0; d < 4; d++) {
        const stand = board.neighbors[box * 4 + OPPOSITE[d]];
        const target = board.neighbors[box * 4 + d];
        if (stand < 0 || !reachable[stand] || target < 0 || !region[target] || occupied[target] || !live[target]) continue;
        const nextBoxes = node.boxes.slice();
        nextBoxes[i] = target;
        nextBoxes.sort((a, b) => a - b);
        const boxKey = nextBoxes.join(',');
        const g = node.g + 1;
        const h = heuristic(nextBoxes, boxKey);
        if (!Number.isFinite(h) || g + h > optimalCost) continue;
        occupied[box] = 0;
        occupied[target] = 1;
        const canonical = flood(box);
        occupied[target] = 0;
        occupied[box] = 1;
        const key = `${boxKey}:${canonical}`;
        const known = bestState.get(key);
        if (known !== undefined && nodes[known].g <= g) continue;
        const nextId = nodes.length;
        nodes.push({ id: nextId, boxes: nextBoxes, player: box, canonical, key,
          g, h, f: g + h, parent: id, box, direction: d });
        bestState.set(key, nextId);
        heap.push(nextId);
      }
    }
  }
  if (chosenGoal === -1) return null;

  const pushes = [];
  for (let id = chosenGoal; nodes[id].parent !== -1; id = nodes[id].parent) pushes.push(nodes[id]);
  pushes.reverse();
  occupied.fill(0);
  for (const box of initialBoxes) occupied[box] = 1;
  let player = start;
  const moves = [];
  for (const node of pushes) {
    const stand = board.neighbors[node.box * 4 + OPPOSITE[node.direction]];
    const walk = shortestWalk(board, walkable, occupied, player, stand);
    if (walk === null) throw new Error('Cannot reconstruct push walk');
    moves.push(walk, PUSH[node.direction]);
    const target = board.neighbors[node.box * 4 + node.direction];
    if (!occupied[node.box] || target < 0 || !region[target] || occupied[target]) throw new Error('Cannot reconstruct push');
    occupied[node.box] = 0;
    occupied[target] = 1;
    player = node.box;
  }
  if (pushes.length !== nodes[chosenGoal].g || player !== nodes[chosenGoal].player) {
    throw new Error('Reconstructed path does not match search');
  }
  if (flood(player, true) !== nodes[chosenGoal].canonical) {
    throw new Error('Reconstructed player region does not match search');
  }
  if ((door < 0 || reachable[door] !== 0) !== allowsExit) {
    throw new Error('Reconstructed exit status does not match search');
  }
  for (const cell of cells) {
    if (occupied[cell] && !goalMask[cell]) throw new Error('Reconstructed room is not solved');
  }
  return { moves: moves.join(''), pushes: nodes[chosenGoal].g, allowsExit };
}

function replayMoves(board, occupied, player, moves) {
  for (const move of moves) {
    const d = WALK.indexOf(move.toLowerCase());
    if (d < 0) throw new Error('Invalid move letter');
    const next = board.neighbors[player * 4 + d];
    if (next < 0) throw new Error('Move into wall');
    if (occupied[next]) {
      const target = board.neighbors[next * 4 + d];
      if (move !== PUSH[d] || target < 0 || occupied[target]) throw new Error('Illegal push');
      occupied[next] = 0;
      occupied[target] = 1;
    } else if (move !== WALK[d]) {
      throw new Error('Uppercase walk');
    }
    player = next;
  }
  return player;
}

function solveLevel(board) {
  const rooms = decompose(board);
  let moves;
  if (rooms === null) {
    const solution = solvePushes(board, { cells: board.cells, boxes: board.boxes,
      goals: board.goals, start: board.player });
    if (!solution) throw new Error('Whole-board search failed');
    moves = solution.moves;
  } else {
    const solvedRooms = rooms.map((room, order) => {
      const solution = solvePushes(board, { ...room, start: room.entry });
      if (!solution) throw new Error(`Room ${order + 1} search failed`);
      return { room, solution, order };
    });
    solvedRooms.sort((a, b) => Number(b.solution.allowsExit) - Number(a.solution.allowsExit) || a.order - b.order);
    const occupied = new Uint8Array(board.size);
    for (const box of board.boxes) occupied[box] = 1;
    let player = board.player;
    const parts = [];
    for (const { room, solution } of solvedRooms) {
      const walk = shortestWalk(board, board.floor, occupied, player, room.entry);
      if (walk === null) throw new Error('Cannot reach next room');
      parts.push(walk, solution.moves);
      player = replayMoves(board, occupied, player, walk);
      player = replayMoves(board, occupied, player, solution.moves);
    }
    moves = parts.join('');
  }

  // Validate the assembled path before emitting it, including the fallback.
  const occupied = new Uint8Array(board.size);
  for (const box of board.boxes) occupied[box] = 1;
  replayMoves(board, occupied, board.player, moves);
  for (const cell of board.cells) {
    if (occupied[cell] && !board.goalMask[cell]) throw new Error('Unsolved box');
  }
  return moves;
}

function main() {
  const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
  const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  const ids = fs.readdirSync(inputDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  fs.mkdirSync(outputDir, { recursive: true });
  for (const id of ids) {
    let moves = '';
    try {
      const text = fs.readFileSync(path.join(inputDir, id, 'level.txt'), 'utf8');
      moves = solveLevel(parseLevel(text));
    } catch (error) {
      console.error(`${id}: ${error.message}`);
    }
    try {
      const instanceDir = path.join(outputDir, id);
      fs.mkdirSync(instanceDir, { recursive: true });
      fs.writeFileSync(path.join(instanceDir, 'solution.txt'), `${moves}\n`);
    } catch (error) {
      console.error(`${id}: cannot write solution: ${error.message}`);
    }
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
