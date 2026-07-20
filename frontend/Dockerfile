# Production image for the Next.js frontend.
#
# NEXT_PUBLIC_API_BASE_URL is inlined at BUILD time (from frontend/.env: "/api",
# so the browser talks same-origin and the reverse proxy routes /api/*).
# API_PROXY_TARGET / INGESTION_PROXY_TARGET are read at RUNTIME by
# next.config.ts rewrites — set them in docker-compose to the service names.
# They only matter as a fallback: in the VM stack Caddy routes /api/* before
# a request ever reaches Next.
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Same-origin API base, inlined at build time. The browser calls /api and the
# reverse proxy (Caddy in the VM stack) routes it to the workflow/ingestion
# services. Overridable via the docker-compose build arg of the same name.
ARG NEXT_PUBLIC_API_BASE_URL=/api
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
