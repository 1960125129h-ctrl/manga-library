
import { pathToFileURL } from 'node:url';
const APP = 'F:/DSH/DSH Desktop/resources/app.asar.unpacked/';
const mod = await import(pathToFileURL(APP + 'node_modules/@deepseek-ai/dsh-agent-presets/lib/index.js').href);
const roots = [
  { path: (process.env.USERPROFILE || '') + '/.dsh/.agent-presets', trust: 'user' },
  { path: APP + 'node_modules/@deepseek-ai/dsh-agent-presets/presets', trust: 'system' },
];
const list = await mod.discoverPresets(roots, pathToFileURL(APP));
const out = list.map(p => ({ id: p.id, name: p.name, order: p.order, trust: p.trust, broken: p.broken, desc: (p.description || '').slice(0, 50) }));
console.log(JSON.stringify(out, null, 1));
