# Dockerfile
FROM node:20-alpine

# Installation de nodemon (pour le développement)
RUN npm install -g nodemon

# Création du dossier de travail
WORKDIR /app

# Copie des dépendances et du code
COPY package*.json ./
RUN npm install --omit=dev # Installer les dépendances de prod

COPY proxy.js .

# On expose un port, mais le port exact sera défini par la variable d'env PORT
EXPOSE 8888

# Commande de démarrage
CMD ["nodemon", "proxy.js"]