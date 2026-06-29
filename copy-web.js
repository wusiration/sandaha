const fs = require('fs');
const path = require('path');

const files = ['index.html', 'manifest.json', 'service-worker.js', 'icon.png'];
const dest = 'www';

if(!fs.existsSync(dest)) fs.mkdirSync(dest, {recursive:true});
for(const f of files){
  fs.copyFileSync(f, path.join(dest, f));
  console.log('copied', f, '->', dest);
}
