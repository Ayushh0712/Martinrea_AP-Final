FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 3002

# nest build emits to dist/src/main.js (tsconfig includes test/ + scripts/).
CMD ["node", "dist/src/main.js"]
