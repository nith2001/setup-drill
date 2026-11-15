// Inlines the chart library, core and app into a single dist/drill.html
const fs = require('fs');
const read = (p) => fs.readFileSync(__dirname + '/' + p, 'utf8');
const html = read('src/template.html')
  .replace('/*LIB*/', () => read('node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js'))
  .replace('/*CORE*/', () => read('src/core.js'))
  .replace('/*APP*/', () => read('src/app.js'));
fs.mkdirSync(__dirname + '/dist/data', { recursive: true });
fs.writeFileSync(__dirname + '/dist/drill.html', html);
console.log('wrote dist/drill.html', (html.length / 1024).toFixed(0) + ' KB');
