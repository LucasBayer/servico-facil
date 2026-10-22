// db.js — conexão única (pool) com o PostgreSQL, reutilizada em toda a API
const path = require('path');

// Lê o .env que está na MESMA pasta deste arquivo, não importa de onde você rode "npm start".
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { Pool } = require('pg');

const obrigatorias = ['PGHOST', 'PGUSER', 'PGPASSWORD', 'PGDATABASE'];
const faltando = obrigatorias.filter(
  (nome) => typeof process.env[nome] !== 'string' || process.env[nome] === ''
);

if (faltando.length > 0) {
  console.error('\n[ERRO] Variáveis ausentes ou vazias: ' + faltando.join(', '));
  console.error('Procurei o arquivo em: ' + path.join(__dirname, '.env'));
  console.error('Confira se o arquivo se chama exatamente ".env" (e não ".env.txt").');
  console.error('Use o .env.example como modelo.\n');
  process.exit(1);
}

const pool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT) || 5432,
  user: process.env.PGUSER,
  password: String(process.env.PGPASSWORD),
  database: process.env.PGDATABASE,
});

pool.on('error', (err) => {
  console.error('Erro inesperado no pool do PostgreSQL:', err.message);
});

module.exports = pool;
