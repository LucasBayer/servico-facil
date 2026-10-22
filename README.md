# ConectaServiços

Hub comunitário de divulgação de prestadores de serviço (Camaquã, Sentinela do Sul, Tapes e Sertão Santana).
Projeto de Extensão Universitária — IFSUL. A plataforma apenas divulga serviços e não intermedeia pagamentos.

**Stack:** Node.js + Express + PostgreSQL, front-end em HTML/CSS/JS puro (pasta `public/`).

## Requisitos
- Node.js 18 ou superior
- PostgreSQL instalado e rodando

## Como rodar
1. Crie o banco no PostgreSQL: `CREATE DATABASE conecta_servicos;`
2. Crie as tabelas: `psql -U postgres -d conecta_servicos -f schema.sql`
3. Copie `.env.example` para `.env` e preencha com os seus dados (o `.env` nunca vai para o Git).
4. Instale as dependências: `npm install`
5. Confira a configuração (opcional): `npm run diagnostico`
6. Inicie: `npm start` e abra http://localhost:3000

Para acessar de outro dispositivo na mesma rede Wi-Fi, use o IP local do computador, por exemplo `http://192.168.0.10:3000`.

## Estrutura
```
db.js                 conexão com o PostgreSQL (lê e valida o .env)
server.js             API Express
schema.sql            criação das tabelas
diagnostico-env.js    verifica o .env sem mostrar senhas
public/               páginas, CSS e js/main.js
```

## Problemas comuns
| Mensagem | Causa provável |
|---|---|
| `Variáveis ausentes ou vazias` | O arquivo se chama `.env.txt` ou não está na pasta do projeto |
| `28P01` / senha incorreta | `PGPASSWORD` do `.env` não é a senha do usuário no PostgreSQL |
| `3D000` | O banco não foi criado |
| `ECONNREFUSED` | O PostgreSQL está desligado ou a porta está errada |

## Limitações conhecidas (protótipo)
- Não há sessão/token: o `usuario_id` vem do navegador. Antes de uso real, implementar autenticação com sessão ou JWT.
