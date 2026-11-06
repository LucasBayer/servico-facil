# ConectaServiços

Hub comunitário de divulgação de prestadores de serviço (Camaquã, Sentinela do Sul, Tapes e Sertão Santana).
Projeto de Extensão Universitária — IFSUL. A plataforma apenas divulga serviços e não intermedeia pagamentos.

**Stack:** Node.js + Express + PostgreSQL, front-end em HTML/CSS/JS puro (pasta `public/`).

## Requisitos
- Node.js 18 ou superior
- PostgreSQL instalado e rodando

## Como rodar
1. Crie o banco no PostgreSQL: `CREATE DATABASE conecta_servicos;`
2. Em um banco novo, execute somente schema.sql: `psql -v ON_ERROR_STOP=1 -U postgres -d conecta_servicos -f schema.sql`
3. Configure PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD e SESSION_SECRET no .env local. Para publicar o contato administrativo no rodapé, configure CONTATO_ADMIN_EMAIL com o endereço institucional real e reinicie o servidor.
4. Instale as dependências: `npm install`
5. Confira a configuração (opcional): `npm run diagnostico`
6. Inicie: `npm start` e abra http://localhost:3000

Para acessar de outro dispositivo na mesma rede Wi-Fi, use o IP local do computador, por exemplo `http://192.168.0.10:3000`.

## Estrutura
```
db.js                 conexão com o PostgreSQL (lê e valida o .env)
server.js             API Express
schema.sql            estrutura atual completa, sem dados de exemplo
migrations/legacy/    schema original e migrações antigas, preservados para histórico
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

## Banco de dados
Para instalações novas, schema.sql reúne as etapas 1, 2 e 3 e deixa as tabelas vazias. A aplicação atual já possui essa estrutura no banco local e dispensa reinstalação.

Os SQLs de migrations/legacy/ são o histórico da instalação anterior. Não os execute após o schema consolidado numa instalação nova. O schema consolidado não converte bancos antigos; uma atualização de instalação antiga exige avaliar seu estado e aplicar apenas as migrações históricas faltantes. Mudanças futuras devem receber novas migrações.

## Testes
Use exclusivamente um banco de teste, com PGDATABASE terminando em _test ou _qa. Crie a estrutura com schema.sql. Execute npm run test:etapa3 para os testes administrativos.

A bateria npm test inclui uma verificação histórica da etapa 2 que exige fixtures específicas: duas ordens com IDs 1 e 2, tipo direcionada, estados em_andamento e concluida e relacionamentos válidos. Essas fixtures não são inseridas pelo schema. Para testar a conversão legada, use outro banco descartável e os arquivos de migrations/legacy/ na ordem schema.sql, migration_001.sql, migration_002.sql e migration_003.sql, preparando os dois históricos antes de migration_002.sql.
