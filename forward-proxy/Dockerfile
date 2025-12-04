# Utilisation d'une image légère de Node.js
FROM node:20-alpine

# Création du dossier de travail
WORKDIR /app

# Copie du script proxy.js dans le conteneur
# Pas besoin de package.json ni de npm install car on utilise des modules natifs (http, url)
COPY forward-proxy.js .

# Le port 8888 doit être exposé pour que Fuseki et le Web puissent s'y connecter
EXPOSE 8888

# Commande de démarrage
CMD ["node", "forward-proxy.js"]