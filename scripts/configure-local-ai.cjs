// Keeps credentials private; changes only the local AI integration settings.
const fs = require('node:fs');
const path = require('node:path');
const {randomBytes} = require('node:crypto');
const dotenv = require('../server/node_modules/dotenv');
const root = path.resolve(__dirname,'..');
const serverFile=path.join(root,'server','.env'), aiFile=path.join(root,'ai-backend','.env');
function read(file){return fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';}
const serverText=read(serverFile),aiText=read(aiFile),server=dotenv.parse(serverText),ai=dotenv.parse(aiText);
if(!server.MONGODB_URI||!server.SESSION_SECRET)throw new Error('Configure your MongoDB URI and session secret privately in server/.env first.');
const origin=server.AI_SERVICE_URL||'http://127.0.0.1:8000';
if(!['http://127.0.0.1:8000','http://localhost:8000'].includes(origin))throw new Error('An existing nonlocal AI origin is configured. Keep its deployment key/settings rather than running local setup.');
const key=server.AI_INTERNAL_KEY||ai.INTERNAL_API_KEY||randomBytes(32).toString('hex');
function update(file,content,values){let lines=content.split(/\r?\n/);for(const [name,value]of Object.entries(values)){lines=lines.filter(line=>!new RegExp('^\\s*(?:export\\s+)?'+name+'\\s*=').test(line));lines.push(name+'='+JSON.stringify(String(value)));}fs.writeFileSync(file,lines.filter((line,index)=>line||index<lines.length-1).join('\n')+'\n');}
update(serverFile,serverText,{CHAT_PROVIDER:'fastapi',EXTRACTION_PROVIDER:'fastapi',AI_SERVICE_URL:origin,AI_INTERNAL_KEY:key,EXTRACTION_TIMEOUT_MS:'125000'});
update(aiFile,aiText,{INTERNAL_API_KEY:key,DEBUG:'false',DEFAULT_MODEL:ai.DEFAULT_MODEL||'llama3.2:3b'});
console.log('Local FastAPI integration configured. Matching private keys were saved without printing them. MongoDB credentials were preserved.');
