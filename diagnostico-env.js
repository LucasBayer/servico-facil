// diagnostico-env.js — rode com: node diagnostico-env.js
// NÃO imprime valores (nem senha): só presença, tipo e tamanho.
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const arquivoEnv = path.join(__dirname, '.env');
console.log('Pasta do projeto :', __dirname);
console.log('Pasta atual (cwd):', process.cwd());
console.log('.env existe?     :', fs.existsSync(arquivoEnv));
console.log('.env.txt existe? :', fs.existsSync(arquivoEnv + '.txt'), '(se true, renomeie para ".env")');

const r = dotenv.config({ path: arquivoEnv });
console.log('dotenv carregou? :', r.error ? 'NÃO (' + r.error.code + ')' : 'sim');

const variaveis = ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PORT'];
let ok = true;
variaveis.forEach((nome) => {
  const v = process.env[nome];
  const presente = typeof v === 'string' && v !== '';
  if (!presente && nome !== 'PORT' && nome !== 'PGPORT') ok = false;
  console.log(nome.padEnd(11), typeof v, presente ? `(${v.length} caracteres)` : '(vazio/indefinido)');
});

if (!ok) {
  console.log('\nFaltam variáveis. Corrija o .env antes de continuar.');
  process.exit(1);
}

// Teste real de conexão (mostra só a mensagem de erro, nunca a senha)
const pool = require('./db');
pool.query('SELECT current_database() AS banco, current_user AS usuario')
  .then((res) => console.log('\nConexão OK →', res.rows[0]))
  .catch((err) => console.log('\nFalha na conexão:', err.code || '', err.message))
  .finally(() => pool.end());
