FROM node:22-alpine AS builder

# Add build tools for better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-alpine AS runner

# Add build tools for better-sqlite3 in case it needs to build on install
RUN apk add --no-cache python3 make g++

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./server.ts 

# Create directory for sqlite database
RUN mkdir -p .data && chown node:node .data

USER node

EXPOSE 3000

CMD ["npm", "start"]
