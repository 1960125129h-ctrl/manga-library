import fs from 'node:fs';
const file = process.argv[2] || '.workbench.json';
const s = fs.readFileSync(file, 'utf8');
try {
  const j = JSON.parse(s);
  console.log(JSON.stringify({
    images: Object.keys(j.images || {}).length,
    boards: Object.keys(j.boards || {}).length,
    currentBoard: j.currentBoard || '',
    boardItems: Object.values(j.boards || {}).map((b) => b.items.length),
    boardsDetail: Object.values(j.boards || {}).map((b) => ({ name: b.name, items: b.items.map((i) => i.id) }))
  }));
} catch (e) {
  console.log(e.message);
  console.log(s.slice(-800));
}
