const fs = require('fs');
const path = require('path');
const body = fs.readFileSync(path.join(__dirname, 'body.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, 'panel.css'), 'utf8');
if (!body.includes('__CSS__')) { console.error('no placeholder'); process.exit(1); }
const BS = String.fromCharCode(92); // backslash
const safe = css
  .split(BS).join(BS + BS)
  .split('`').join(BS + '`')
  .split('${').join(BS + '${');
const out = body.replace('__CSS__', safe);
// 产物直接写入 lib/client.js：body.js 已含 ModuleLoader 外壳，可直接被 DSH 加载
const target = path.join(__dirname, '..', 'lib', 'client.js');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, out, 'utf8');
console.log('assembled -> lib/client.js (' + out.length + ' bytes)');
