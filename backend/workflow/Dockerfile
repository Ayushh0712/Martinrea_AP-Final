FROM node:20-alpine

WORKDIR /app

# OCR pipeline system dependencies:
#   poppler-utils  -> pdf-poppler (PDF -> image)
#   graphicsmagick + ghostscript -> pdf2pic rasterisation
#   tesseract-ocr (+ eng/spa language data) -> C++ OCR engine invoked via CLI
#   vips -> native lib backing `sharp` image preprocessing
RUN apk add --no-cache \
  poppler-utils \
  graphicsmagick \
  ghostscript \
  tesseract-ocr \
  tesseract-ocr-data-eng \
  tesseract-ocr-data-spa \
  vips

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 3001

# Schema is created by Sequelize (synchronize in non-prod; Flyway owns prod).
CMD ["node", "dist/main.js"]
