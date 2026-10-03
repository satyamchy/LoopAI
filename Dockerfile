FROM node:22-bookworm-slim
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/toolkits/package.json packages/toolkits/
COPY packages/vault/package.json packages/vault/
RUN corepack pnpm install --frozen-lockfile
COPY . .
RUN corepack pnpm --filter @loopai/web build
ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787
WORKDIR /app/apps/api
CMD ["corepack", "pnpm", "start"]
