import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.dirname(fileURLToPath(import.meta.url));
const inputDir = path.join(root, 'practice', 'input');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'practice', 'reference', 'manifest.json'), 'utf8'));
const instances = manifest.instances.slice().sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const temporary = fs.mkdtempSync(path.join(root, '.dev-check-'));

function runSolver(outputDir) {
  const run = spawnSync(process.execPath, [path.join(root, 'main.ts')], {
    cwd: root,
    env: { ...process.env, MAKEFUN_INPUT_DIR: inputDir, MAKEFUN_OUTPUT_DIR: outputDir },
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(`Solver exited with ${run.status}: ${run.stderr.trim()}`);
  if (run.stderr) process.stderr.write(run.stderr);
}

// This replay uses coordinate strings and sets, independent of the solver's
// indexed grid, neighbor tables, decomposition, and search implementation.
function replay(level, solution) {
  if (!solution.endsWith('\n') || /[^udlrUDLR]/.test(solution.slice(0, -1))) {
    throw new Error('Expected move letters and exactly one trailing newline');
  }
  const moves = solution.slice(0, -1);
  const floor = new Set();
  const goals = new Set();
  const boxes = new Set();
  let player = null;
  const rows = level.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x];
      const key = `${x},${y}`;
      if (ch === ' ' || ch === '.' || ch === '$' || ch === '*' || ch === '@' || ch === '+') floor.add(key);
      if (ch === '.' || ch === '*' || ch === '+') goals.add(key);
      if (ch === '$' || ch === '*') boxes.add(key);
      if (ch === '@' || ch === '+') {
        if (player !== null) throw new Error('Multiple players in level');
        player = [x, y];
      }
    }
  }
  if (player === null) throw new Error('Missing player in level');
  const directions = { u: [0, -1], d: [0, 1], l: [-1, 0], r: [1, 0] };
  let pushes = 0;
  for (let i = 0; i < moves.length; i++) {
    const move = moves[i];
    const [dx, dy] = directions[move.toLowerCase()];
    const x = player[0] + dx;
    const y = player[1] + dy;
    const next = `${x},${y}`;
    if (!floor.has(next)) throw new Error(`Step ${i + 1} enters a wall or missing cell`);
    if (boxes.has(next)) {
      const target = `${x + dx},${y + dy}`;
      if (!floor.has(target) || boxes.has(target)) throw new Error(`Step ${i + 1} is an illegal push`);
      if (move !== move.toUpperCase()) throw new Error(`Step ${i + 1} is a lowercase push`);
      boxes.delete(next);
      boxes.add(target);
      pushes++;
    } else if (move !== move.toLowerCase()) {
      throw new Error(`Step ${i + 1} is an uppercase walk`);
    }
    player = [x, y];
  }
  const remaining = [...boxes].filter(box => !goals.has(box)).length;
  return { pushes, remaining };
}

try {
  const first = path.join(temporary, 'first');
  const second = path.join(temporary, 'second');
  runSolver(first);
  runSolver(second);
  let passed = 0;
  let deterministic = true;
  let compared = 0;
  for (const instance of instances) {
    let pushes = '?';
    const target = instance.key.pushes;
    try {
      const solution = fs.readFileSync(path.join(first, instance.id, 'solution.txt'));
      const repeated = fs.readFileSync(path.join(second, instance.id, 'solution.txt'));
      if (!solution.equals(repeated)) {
        deterministic = false;
        throw new Error('Repeated outputs differ');
      }
      compared++;
      const result = replay(fs.readFileSync(path.join(inputDir, instance.id, 'level.txt'), 'utf8'), solution.toString('utf8'));
      pushes = result.pushes;
      if (result.remaining !== 0) throw new Error(`${result.remaining} boxes are off goals`);
      if (pushes !== target) throw new Error('Push count does not match the manifest');
      passed++;
      console.log(`${instance.id}: ${pushes} pushes (target ${target}) PASS`);
    } catch (error) {
      console.log(`${instance.id}: ${pushes} pushes (target ${target}) FAIL — ${error.message}`);
    }
  }
  deterministic = deterministic && compared === instances.length;
  console.log(`Determinism: ${deterministic ? 'PASS' : 'FAIL'} (two runs)`);
  console.log(`${passed}/${instances.length} instances PASS`);
  if (passed !== instances.length || !deterministic) process.exitCode = 1;
} catch (error) {
  console.error(`FAIL — ${error.message}`);
  process.exitCode = 1;
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
