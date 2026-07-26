# Railway builds this image for the Hey Nikki API server (Express/TypeScript).
FROM node:20-slim

WORKDIR /app

# Install deps first so Docker caches this layer across code changes.
COPY package*.json ./
RUN npm install

COPY . .

# Compile TypeScript -> dist/
RUN npm run build

# Railway injects $PORT; index.ts already reads process.env.PORT.
CMD ["node", "dist/index.js"]
