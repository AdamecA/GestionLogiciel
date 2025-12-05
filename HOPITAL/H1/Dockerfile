FROM node:20-alpine

WORKDIR /app

# Installez nodemon avec les dépendances de prod
COPY package*.json ./
RUN npm install
RUN npm install -g nodemon

COPY proxy.js .

EXPOSE 4000
CMD ["nodemon", "proxy.js"]