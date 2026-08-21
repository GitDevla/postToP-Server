# PostTop Server

Backend service for PostTop. Provides REST APIs, WebSocket support, PostgreSQL access, and Swagger docs.

## Stack

- Node.js + TypeScript
- Express
- PostgreSQL + Kysely
- WebSocket (`ws`)
- Swagger (`/docs`)

## Requirements

- Node.js 20+
- PostgreSQL

## Environment Variables

Create a `.env` file in the project root.


- `DATABASE_URL` - PostgreSQL connection string
- `JWT_TOKEN` - JWT signing secret
- `AI_MODEL_URL` - Is-Music Classifier model endpoint
- `AI_MODEL_URL_NER` - NER model endpoint
- `AI_MODEL_URL_GENRE` - genre model endpoint
- `YT_API_KEY` - YouTube API key
- `LOG_LEVEL` - logger level (default: `debug`)

## Run

```bash
npm install
npm run dev
```

Server starts on `http://localhost:8000`.

## Scripts

- `npm run dev` - run in development with `ts-node` + `nodemon`
- `npm run build` - build TypeScript output to `dist`
- `npm run serve` - run compiled build from `dist`
- `npm run seed` - run TypeScript DB seed script (local/dev)
- `npm run seed:prod` - run compiled DB seed script (Docker/production)
- `npm run lint` - run Biome checks
- `npm run format` - format code with Biome
- `npm run kysely` - generate Kysely types

## Database Seeding

The seeder is idempotent and can be run multiple times safely.

It currently seeds:

- `role` (`Admin`, `User`)
- `main_category` (core YouTube main categories)
- `category` (common YouTube categories)
- baseline `model` rows for each AI model type if missing

Optional admin bootstrap:

- set `SEED_CREATE_ADMIN=true`
- set `SEED_ADMIN_PASSWORD=<your password>`
- optional: `SEED_ADMIN_USERNAME` (default: `admin`)
- optional: `SEED_ADMIN_EMAIL` (default: `admin@posttop.local`)

Run locally:

```bash
npm run seed
```

## Docker

```bash
docker build -t posttop-server .
docker run --env-file .env -p 8000:8000 posttop-server
```

Run the seeder in Docker (against the same DB from your `.env`):

```bash
docker run --rm --env-file .env posttop-server npm run seed:prod
```

If your database is another container, make sure both containers are on the same Docker network and use the DB container name as host in `DATABASE_URL`.