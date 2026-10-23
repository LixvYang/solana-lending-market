FROM node:24.10.0-slim

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.25.0 --activate
COPY package.json pnpm-lock.yaml ./
COPY tsconfig.json ./
COPY scenario ./scenario
COPY src ./src
COPY scripts ./scripts
COPY fixtures ./fixtures
COPY program/devnet.json ./program/devnet.json
RUN pnpm install --frozen-lockfile

ENV NODE_ENV=production
CMD ["node", "--import", "tsx", "scripts/serve-api.ts"]
