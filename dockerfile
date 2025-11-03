FROM node:20-slim

WORKDIR /app

# Copier package.json
COPY package.json .

# Installer SEULEMENT les dépendances de production
RUN npm install --production

# Copier l'app
COPY app.js .

EXPOSE 3000

CMD ["node", "app.js"]