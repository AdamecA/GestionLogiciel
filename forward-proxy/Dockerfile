# Utilisation d'une image légère de Node.js
FROM node:20-alpine

# Installation de nodemon (Globalement pour le dev)
# Utilisez --omit=dev pour la production pour économiser de l'espace
RUN npm install -g nodemon

# Création du dossier de travail
WORKDIR /app

# Copie du script proxy.js dans le conteneur
COPY forward-proxy.js .

# Le port 8888 doit être exposé
EXPOSE 8888

# Commande de démarrage modifiée pour utiliser nodemon
# Nodemon surveillera les changements dans forward-proxy.js
CMD ["nodemon", "forward-proxy.js"]