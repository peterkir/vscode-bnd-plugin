#!/usr/bin/env node
// Turns the lcov report of `npm run test:coverage` into a shields.io endpoint file for the README coverage badge.
//
//   node scripts/coverageBadge.mjs [coverage/lcov.info] [coverage-badge/coverage.json]
//
// The percentage is covered lines (LH) over instrumented lines (LF) across all records, the same figure as the
// "Lines" column of the c8 summary. CI publishes the file to the `badges` branch.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const [input = 'coverage/lcov.info', output = 'coverage-badge/coverage.json'] = process.argv.slice(2);

let found = 0;
let hit = 0;
for (const line of readFileSync(input, 'utf8').split(/\r?\n/)) {
    if (line.startsWith('LF:')) found += Number(line.slice(3));
    else if (line.startsWith('LH:')) hit += Number(line.slice(3));
}
if (found === 0) {
    console.error(`No instrumented lines found in ${input}`);
    process.exit(1);
}

const percent = (hit / found) * 100;
const color = percent >= 90 ? 'brightgreen' : percent >= 80 ? 'green' : percent >= 70 ? 'yellowgreen' : percent >= 60 ? 'yellow' : percent >= 50 ? 'orange' : 'red';

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify({ schemaVersion: 1, label: 'codecov', message: `${percent.toFixed(1)}%`, color }) + '\n');
console.log(`Line coverage ${percent.toFixed(1)}% (${hit}/${found}) -> ${output}`);
