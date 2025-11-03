const Docker = require("dockerode");
const path = require("path");
const os = require("os");

// Connexion à Docker
const docker = new Docker({
  socketPath: path.join(os.homedir(), ".rd", "docker.sock"),
});

// ⚙️ CONFIGURATION
const CONFIG = {
  // Application
  APP_NAME: "test-app",
  IMAGE: "test-app:latest",
  BASE_PORT: 8000,

  // Ressources serveur
  SERVER_TOTAL_CPU: 4,
  SERVER_TOTAL_RAM: 16, // GB

  // Ressources par conteneur
  CONTAINER_CPU: 0.8,
  CONTAINER_RAM: 1.0, // GB

  // Limites
  MIN_CONTAINERS: 1,
  MAX_CONTAINERS: 4,

  // Auto-scaling
  USERS_PER_CONTAINER: 500,
  MAX_USERS_CAPACITY: 2000,

  // Simulation
  SIMULATION_INTERVAL: 1000, // 1 seconde
  USERS_INCREMENT: 100, // +100 users par seconde
  USERS_MAX: 2000, // Maximum avant alerte
  USERS_MIN: 400, // Minimum lors de la descente
  ALERT_PAUSE_DURATION: 30, // 30 secondes de pause pour l'alerte
};

// 🎨 Couleurs pour la console
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

// Variables de simulation
let currentUsers = 0;
let isIncreasing = true;
let simulationPaused = false;
let alertShown = false;

// 🔍 Obtenir les conteneurs actifs
async function getActiveContainers() {
  try {
    const containers = await docker.listContainers({
      filters: { label: [`app=${CONFIG.APP_NAME}`] },
    });

    return containers.map((c) => ({
      id: c.Id.substring(0, 12),
      name: c.Names[0].replace("/", ""),
      status: c.Status,
      port: c.Ports[0]?.PublicPort || "N/A",
    }));
  } catch (error) {
    console.error(
      `${colors.red}❌ Erreur lors de la récupération des conteneurs:${colors.reset}`,
      error.message
    );
    return [];
  }
}

// 📈 Calculer le nombre de conteneurs nécessaires
function calculateDesiredContainers(users) {
  if (users <= 0) return 1;

  const needed = Math.ceil(users / CONFIG.USERS_PER_CONTAINER);
  return Math.max(
    CONFIG.MIN_CONTAINERS,
    Math.min(needed, CONFIG.MAX_CONTAINERS)
  );
}

// 🚀 SCALE UP : Créer de nouveaux conteneurs
async function scaleUp(current, desired, users) {
  const toCreate = desired - current;

  console.log(
    `\n${colors.green}${colors.bright}🚀 SCALE UP: +${toCreate} conteneur(s)${colors.reset}`
  );
  console.log(
    `${colors.cyan}   Raison: ${users} utilisateurs nécessitent ${desired} conteneur(s)${colors.reset}\n`
  );

  for (let i = 0; i < toCreate; i++) {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000);
    const name = `${CONFIG.APP_NAME}-${timestamp}-${random}`;
    const instanceNum = current + i + 1;

    try {
      console.log(
        `${colors.cyan}   [${i + 1}/${toCreate}] 📦 Création de ${name}...${
          colors.reset
        }`
      );

      const container = await docker.createContainer({
        Image: CONFIG.IMAGE,
        name: name,
        Labels: {
          app: CONFIG.APP_NAME,
          instance: String(instanceNum),
        },
        Env: [`INSTANCE_NAME=${name}`, `PORT=3000`],
        ExposedPorts: { "3000/tcp": {} },
        HostConfig: {
          Memory: CONFIG.CONTAINER_RAM * 1024 * 1024 * 1024,
          NanoCpus: CONFIG.CONTAINER_CPU * 1000000000,
          PortBindings: {
            "3000/tcp": [{ HostPort: "0" }],
          },
          RestartPolicy: {
            Name: "unless-stopped",
          },
        },
      });

      await container.start();

      const info = await container.inspect();
      const port = info.NetworkSettings.Ports["3000/tcp"][0].HostPort;

      console.log(
        `${colors.green}        ✅ Démarré → http://localhost:${port}${colors.reset}`
      );

      await new Promise((r) => setTimeout(r, 300));
    } catch (error) {
      console.error(
        `${colors.red}        ❌ Erreur: ${error.message}${colors.reset}`
      );
    }
  }

  console.log(
    `\n${colors.green}${colors.bright}✅ Scale UP terminé !${colors.reset}\n`
  );
}

// 📉 SCALE DOWN : Supprimer des conteneurs
async function scaleDown(current, desired, users) {
  const toRemove = current - desired;

  console.log(
    `\n${colors.yellow}${colors.bright}📉 SCALE DOWN: -${toRemove} conteneur(s)${colors.reset}`
  );
  console.log(
    `${colors.cyan}   Raison: ${users} utilisateurs nécessitent ${desired} conteneur(s)${colors.reset}\n`
  );

  const containers = await docker.listContainers({
    filters: { label: [`app=${CONFIG.APP_NAME}`] },
    all: false,
  });

  // Supprimer les derniers créés (LIFO)
  const toDelete = containers.slice(-toRemove);

  for (let i = 0; i < toDelete.length; i++) {
    const containerInfo = toDelete[i];
    const name = containerInfo.Names[0].replace("/", "");

    try {
      console.log(
        `${colors.yellow}   [${i + 1}/${toRemove}] 🗑️  Arrêt de ${name}...${
          colors.reset
        }`
      );

      const container = docker.getContainer(containerInfo.Id);
      await container.stop({ t: 10 });
      await container.remove();

      console.log(`${colors.green}        ✅ Supprimé${colors.reset}`);
    } catch (error) {
      console.error(
        `${colors.red}        ❌ Erreur: ${error.message}${colors.reset}`
      );
    }
  }

  console.log(
    `\n${colors.green}${colors.bright}✅ Scale DOWN terminé !${colors.reset}\n`
  );
}

// 📊 Afficher le dashboard
function displayDashboard(users, containers, desired) {
  const currentCount = containers.length;
  const cpuUsed = (currentCount * CONFIG.CONTAINER_CPU).toFixed(1);
  const cpuPercent = ((cpuUsed / CONFIG.SERVER_TOTAL_CPU) * 100).toFixed(1);
  const ramUsed = (currentCount * CONFIG.CONTAINER_RAM).toFixed(1);
  const ramPercent = ((ramUsed / CONFIG.SERVER_TOTAL_RAM) * 100).toFixed(1);
  const capacity = currentCount * CONFIG.USERS_PER_CONTAINER;

  console.clear();
  console.log(`${colors.bright}${colors.blue}${"═".repeat(90)}${colors.reset}`);
  console.log(
    `${colors.bright}${
      colors.cyan
    }      🚀 AUTO-SCALER - SIMULATION AUTOMATIQUE - ${new Date().toLocaleTimeString()}${
      colors.reset
    }`
  );
  console.log(
    `${colors.bright}${colors.blue}${"═".repeat(90)}${colors.reset}\n`
  );

  // Indicateur de tendance
  const trend = isIncreasing
    ? `${colors.green}📈 AUGMENTATION${colors.reset}`
    : `${colors.yellow}📉 DIMINUTION${colors.reset}`;

  console.log(`${colors.bright}📊 SIMULATION${colors.reset}`);
  console.log(
    `   Tendance:  ${trend} (+/- ${CONFIG.USERS_INCREMENT} users/seconde)`
  );
  console.log(
    `   Objectif:  ${
      isIncreasing
        ? `${CONFIG.USERS_MAX} users (puis redescente)`
        : `${CONFIG.USERS_MIN} users (puis arrêt)`
    }`
  );
  console.log("");

  // Utilisateurs
  console.log(`${colors.bright}👥 UTILISATEURS${colors.reset}`);
  console.log(
    `   Actuels:   ${colors.bright}${colors.magenta}${users.toLocaleString()}${
      colors.reset
    } utilisateurs`
  );
  console.log(
    `   Capacité:  ${colors.bright}${capacity.toLocaleString()}${
      colors.reset
    } utilisateurs ${
      users > capacity
        ? colors.red + "⚠️  DÉPASSÉ" + colors.reset
        : colors.green + "✓" + colors.reset
    }`
  );

  // Barre de progression globale
  const progressPercent = Math.min(100, (users / CONFIG.USERS_MAX) * 100);
  const progressBars = Math.floor(progressPercent / 2);
  const progressColor =
    progressPercent > 90
      ? colors.red
      : progressPercent > 70
      ? colors.yellow
      : colors.green;

  console.log(`\n   Progression globale:`);
  console.log(
    `   ${progressColor}${"█".repeat(progressBars)}${"░".repeat(
      50 - progressBars
    )}${colors.reset} ${progressPercent.toFixed(0)}% (${users}/${
      CONFIG.USERS_MAX
    })`
  );
  console.log("");

  // Conteneurs avec barres de progression individuelles
  console.log(`${colors.bright}📦 CONTENEURS${colors.reset}`);
  console.log(
    `   Actuel:  ${colors.bright}${colors.green}${currentCount}${colors.reset} conteneur(s) | ` +
      `Désiré:  ${colors.bright}${colors.yellow}${desired}${colors.reset} conteneur(s) | ` +
      `Min/Max: ${CONFIG.MIN_CONTAINERS}/${CONFIG.MAX_CONTAINERS}`
  );

  if (containers.length > 0) {
    console.log(
      `\n   ${colors.cyan}État détaillé des conteneurs:${colors.reset}`
    );
    console.log("");

    containers.forEach((c, index) => {
      const startRange = index * CONFIG.USERS_PER_CONTAINER;
      const endRange = (index + 1) * CONFIG.USERS_PER_CONTAINER;

      // Calculer la charge de ce conteneur
      const containerUsers = Math.min(
        Math.max(0, users - startRange),
        CONFIG.USERS_PER_CONTAINER
      );
      const containerPercent =
        (containerUsers / CONFIG.USERS_PER_CONTAINER) * 100;
      const containerBars = Math.floor(containerPercent / 5); // 20 barres max

      // Couleur selon la charge
      let barColor = colors.green;
      let statusIcon = "✓";
      if (containerPercent > 95) {
        barColor = colors.red;
        statusIcon = "⚠️";
      } else if (containerPercent > 80) {
        barColor = colors.yellow;
        statusIcon = "⚡";
      }

      // Nom du conteneur
      console.log(
        `   ${colors.bright}Conteneur ${index + 1}${colors.reset} ${
          colors.cyan
        }(Port ${c.port})${colors.reset}`
      );

      // Barre de progression
      console.log(
        `   ${barColor}${"█".repeat(containerBars)}${"░".repeat(
          20 - containerBars
        )}${colors.reset} ` +
          `${containerPercent.toFixed(0)}% ${statusIcon} (${containerUsers}/${
            CONFIG.USERS_PER_CONTAINER
          } users)`
      );

      // Nom technique
      console.log(`   ${colors.cyan}${c.name.substring(0, 50)}${colors.reset}`);
      console.log("");
    });
  } else {
    console.log(`\n   ${colors.yellow}Aucun conteneur actif${colors.reset}\n`);
  }

  // Ressources
  console.log(`${colors.bright}💻 RESSOURCES SERVEUR${colors.reset}`);
  console.log(
    `   CPU:  ${cpuUsed}/${
      CONFIG.SERVER_TOTAL_CPU
    } CPUs (${cpuPercent}%) ${"█".repeat(Math.floor(cpuPercent / 5))}`
  );
  console.log(
    `   RAM:  ${ramUsed}/${
      CONFIG.SERVER_TOTAL_RAM
    } GB (${ramPercent}%) ${"█".repeat(Math.floor(ramPercent / 5))}`
  );
  console.log("");

  // État du scaling
  if (currentCount < desired) {
    console.log(
      `${colors.yellow}⏳ Prochain cycle: Scale UP vers ${desired} conteneur(s)${colors.reset}`
    );
  } else if (currentCount > desired) {
    console.log(
      `${colors.yellow}⏳ Prochain cycle: Scale DOWN vers ${desired} conteneur(s)${colors.reset}`
    );
  } else {
    console.log(`${colors.green}✅ Scaling optimal${colors.reset}`);
  }

  console.log(
    `\n${colors.bright}${colors.blue}${"═".repeat(90)}${colors.reset}`
  );
  console.log(
    `${colors.cyan}💡 Appuyez sur Ctrl+C pour arrêter la simulation${colors.reset}\n`
  );
}

// 🚨 Afficher l'alerte de scaling horizontal
function displayHorizontalScalingAlert() {
  console.clear();
  console.log(`\n${"═".repeat(90)}`);
  console.log(`${colors.red}${colors.bright}
╔════════════════════════════════════════════════════════════════════════════════╗
║                                                                                ║
║                   🚨 ALERTE : LIMITE SERVEUR ATTEINTE ! 🚨                     ║
║                                                                                ║
║                     SCALING HORIZONTAL REQUIS                                  ║
║                                                                                ║
╚════════════════════════════════════════════════════════════════════════════════╝
${colors.reset}`);

  console.log(
    `\n${colors.yellow}${colors.bright}📊 SITUATION ACTUELLE:${colors.reset}`
  );
  console.log(
    `   • Utilisateurs actuels: ${colors.bright}${colors.red}${currentUsers}${colors.reset}`
  );
  console.log(
    `   • Capacité maximale: ${colors.bright}${CONFIG.MAX_USERS_CAPACITY}${colors.reset} utilisateurs/serveur`
  );
  console.log(
    `   • Conteneurs: ${colors.bright}${CONFIG.MAX_CONTAINERS}/${CONFIG.MAX_CONTAINERS}${colors.reset} (MAXIMUM ATTEINT)`
  );
  console.log(
    `   • ${colors.red}${colors.bright}⚠️  Vous avez dépassé la capacité d'un seul serveur !${colors.reset}`
  );

  console.log(
    `\n${colors.cyan}${colors.bright}💡 SOLUTION REQUISE : SCALING HORIZONTAL${colors.reset}`
  );

  console.log(
    `\n${colors.green}${colors.bright}1️⃣  AJOUTER UN NOUVEAU SERVEUR${colors.reset}`
  );
  console.log(`   ${colors.cyan}Architecture recommandée:${colors.reset}`);
  console.log(`
        ${colors.cyan}Internet${colors.reset}
           ↓
    ${colors.magenta}╔═══════════════╗${colors.reset}
    ${colors.magenta}║ Load Balancer ║${colors.reset} (NGINX/HAProxy/AWS ALB)
    ${colors.magenta}╚═══════════════╝${colors.reset}
           ↓
    ┌──────┴──────┐
    ↓             ↓
${colors.green}┌─────────────┐ ┌─────────────┐${colors.reset}
${colors.green}│  Serveur 1  │ │  Serveur 2  │${colors.reset}
${colors.green}│ 2000 users  │ │ 2000 users  │${colors.reset}
${colors.green}│ 4 conteneur │ │ 4 conteneur │${colors.reset}
${colors.green}└─────────────┘ └─────────────┘${colors.reset}
  `);
  console.log(
    `   ${colors.green}✅ Nouvelle capacité totale: ${colors.bright}4000 utilisateurs${colors.reset}`
  );
  console.log(
    `   ${colors.green}✅ Tolérance aux pannes: Un serveur peut tomber${colors.reset}`
  );
  console.log(
    `   ${colors.green}✅ Distribution de charge: Trafic équilibré${colors.reset}`
  );

  console.log(
    `\n${colors.green}${colors.bright}2️⃣  ÉTAPES DE MISE EN PLACE${colors.reset}`
  );
  console.log(
    `   ${colors.cyan}a)${colors.reset} Provisionner un 2ème serveur identique (4 CPU, 16 GB RAM)`
  );
  console.log(
    `   ${colors.cyan}b)${colors.reset} Installer Docker et déployer l'application identique`
  );
  console.log(
    `   ${colors.cyan}c)${colors.reset} Configurer un Load Balancer devant les 2 serveurs`
  );
  console.log(
    `   ${colors.cyan}d)${colors.reset} Configurer la distribution (Round-Robin, Least Connections, etc.)`
  );
  console.log(
    `   ${colors.cyan}e)${colors.reset} Tester la haute disponibilité et le basculement`
  );

  console.log(
    `\n${colors.green}${colors.bright}3️⃣  ALTERNATIVES POSSIBLES${colors.reset}`
  );

  console.log(
    `\n   ${colors.yellow}Option A - Scaling Vertical:${colors.reset}`
  );
  console.log(`   • Augmenter CPU/RAM du serveur actuel`);
  console.log(`   • Passer à: ${colors.bright}8 CPU, 32 GB RAM${colors.reset}`);
  console.log(
    `   • Augmenter MAX_CONTAINERS à ${colors.bright}8${colors.reset}`
  );
  console.log(
    `   • Nouvelle capacité: ${colors.bright}4000 utilisateurs${colors.reset}`
  );
  console.log(
    `   • ${colors.red}Limite:${colors.reset} Point unique de défaillance`
  );

  console.log(
    `\n   ${colors.yellow}Option B - Orchestration (Kubernetes/Swarm):${colors.reset}`
  );
  console.log(`   • Cluster de conteneurs auto-géré`);
  console.log(`   • Auto-scaling automatique sur plusieurs nœuds`);
  console.log(`   • Haute disponibilité intégrée`);
  console.log(`   • Rolling updates sans interruption`);
  console.log(
    `   • ${colors.green}Recommandé:${colors.reset} Pour production à grande échelle`
  );

  const excessUsers = currentUsers - CONFIG.MAX_USERS_CAPACITY;
  const serversNeeded = Math.ceil(currentUsers / CONFIG.MAX_USERS_CAPACITY);

  console.log(
    `\n${colors.red}${colors.bright}📌 RECOMMANDATION IMMÉDIATE:${colors.reset}`
  );
  console.log(
    `   • Utilisateurs: ${colors.bright}${currentUsers}${colors.reset}`
  );
  console.log(
    `   • Serveurs nécessaires: ${colors.bright}${colors.red}${serversNeeded}${colors.reset}`
  );
  console.log(
    `   • Capacité manquante: ${colors.bright}${colors.red}${excessUsers} utilisateurs${colors.reset}`
  );
  console.log(
    `   • ${colors.green}${colors.bright}→ Action: Ajoutez ${
      serversNeeded - 1
    } serveur(s) supplémentaire(s) IMMÉDIATEMENT${colors.reset}`
  );

  console.log(`\n${"═".repeat(90)}`);
  console.log(
    `${colors.cyan}${colors.bright}⏳ La simulation va reprendre dans ${CONFIG.ALERT_PAUSE_DURATION} secondes...${colors.reset}\n`
  );
}

// 🔄 Boucle de simulation
async function simulationLoop() {
  try {
    // Récupérer l'état actuel
    const containers = await getActiveContainers();
    const currentCount = containers.length;
    const desired = calculateDesiredContainers(currentUsers);

    // Afficher le dashboard
    displayDashboard(currentUsers, containers, desired);

    // Effectuer le scaling si nécessaire
    if (currentCount < desired && currentUsers <= CONFIG.MAX_USERS_CAPACITY) {
      await scaleUp(currentCount, desired, currentUsers);
    } else if (currentCount > desired) {
      await scaleDown(currentCount, desired, currentUsers);
    }

    // Gérer l'alerte à 2000 users
    if (currentUsers >= CONFIG.USERS_MAX && isIncreasing && !alertShown) {
      alertShown = true;
      simulationPaused = true;

      displayHorizontalScalingAlert();

      // Pause avec compte à rebours
      for (let i = CONFIG.ALERT_PAUSE_DURATION; i > 0; i--) {
        process.stdout.write(
          `\r${colors.cyan}⏳ Reprise dans ${colors.bright}${i
            .toString()
            .padStart(2, "0")}${colors.reset}${colors.cyan} secondes... ${
            colors.yellow
          }${"█".repeat(Math.floor((CONFIG.ALERT_PAUSE_DURATION - i) / 2))}${
            colors.reset
          }`
        );
        await new Promise((r) => setTimeout(r, 1000));
      }
      console.log(`\n`);

      // Passer en mode décroissant
      isIncreasing = false;
      simulationPaused = false;

      console.log(
        `${colors.green}${colors.bright}▶️  Reprise de la simulation en mode décroissant...${colors.reset}\n`
      );
      await new Promise((r) => setTimeout(r, 2000));
    }

    // Mise à jour du nombre d'utilisateurs
    if (!simulationPaused) {
      if (isIncreasing) {
        currentUsers += CONFIG.USERS_INCREMENT;
        if (currentUsers > CONFIG.USERS_MAX) {
          currentUsers = CONFIG.USERS_MAX;
        }
      } else {
        currentUsers -= CONFIG.USERS_INCREMENT;
        if (currentUsers <= CONFIG.USERS_MIN) {
          currentUsers = CONFIG.USERS_MIN;
          // Fin de la simulation
          console.log(
            `\n${colors.green}${colors.bright}✅ Simulation terminée !${colors.reset}`
          );
          console.log(
            `${colors.cyan}Utilisateurs minimum atteint: ${currentUsers}${colors.reset}\n`
          );

          // Afficher le dashboard final
          const finalContainers = await getActiveContainers();
          const finalDesired = calculateDesiredContainers(currentUsers);
          displayDashboard(currentUsers, finalContainers, finalDesired);

          console.log(
            `${colors.yellow}La simulation va s'arrêter dans 5 secondes...${colors.reset}`
          );
          await new Promise((r) => setTimeout(r, 5000));

          console.log(`${colors.green}Nettoyage et arrêt...${colors.reset}\n`);
          await cleanup();
          process.exit(0);
        }
      }
    }
  } catch (error) {
    console.error(
      `${colors.red}❌ Erreur dans la boucle:${colors.reset}`,
      error.message
    );
  }
}

// 🧹 Nettoyage
async function cleanup() {
  console.log(`${colors.yellow}🧹 Nettoyage des conteneurs...${colors.reset}`);

  try {
    const containers = await docker.listContainers({
      all: true,
      filters: { label: [`app=${CONFIG.APP_NAME}`] },
    });

    for (const c of containers) {
      const container = docker.getContainer(c.Id);
      const name = c.Names[0].replace("/", "");

      console.log(`   Suppression de ${name}...`);

      if (c.State === "running") {
        await container.stop({ t: 5 });
      }
      await container.remove();
    }

    console.log(`${colors.green}✅ Nettoyage terminé${colors.reset}\n`);
  } catch (error) {
    console.log(
      `${colors.yellow}⚠️  Erreur lors du nettoyage${colors.reset}\n`
    );
  }
}

// 🚀 Démarrage
async function start() {
  console.log(`${colors.bright}${colors.cyan}
╔════════════════════════════════════════════════════════════════════════════════╗
║                                                                                ║
║              🚀 AUTO-SCALER - SIMULATION AUTOMATIQUE V2 🚀                     ║
║                         Visualisation Améliorée                                ║
║                                                                                ║
║  Scénario: 0 → 2000 users (+100/sec) → ALERTE 30s → 2000 → 400 users         ║
║                                                                                ║
╚════════════════════════════════════════════════════════════════════════════════╝
${colors.reset}\n`);

  console.log(`${colors.bright}📋 Configuration:${colors.reset}`);
  console.log(`   Application: ${CONFIG.APP_NAME}`);
  console.log(`   Image: ${CONFIG.IMAGE}`);
  console.log(
    `   ${CONFIG.USERS_PER_CONTAINER} users/conteneur | Max: ${CONFIG.MAX_CONTAINERS} conteneurs | Capacité: ${CONFIG.MAX_USERS_CAPACITY} users`
  );
  console.log(`\n${colors.bright}🎬 Scénario de simulation:${colors.reset}`);
  console.log(
    `   ${colors.green}1.${colors.reset} Augmentation: 0 → ${CONFIG.USERS_MAX} users (+${CONFIG.USERS_INCREMENT}/seconde)`
  );
  console.log(
    `   ${colors.red}2.${colors.reset} Alerte à ${CONFIG.USERS_MAX} users (pause ${CONFIG.ALERT_PAUSE_DURATION} secondes)`
  );
  console.log(
    `   ${colors.yellow}3.${colors.reset} Diminution: ${CONFIG.USERS_MAX} → ${CONFIG.USERS_MIN} users (-${CONFIG.USERS_INCREMENT}/seconde)`
  );
  console.log(
    `   ${colors.cyan}4.${colors.reset} Arrêt automatique et nettoyage\n`
  );

  console.log(`${colors.bright}✨ Nouvelles fonctionnalités:${colors.reset}`);
  console.log(
    `   ${colors.green}•${colors.reset} Barre de progression pour chaque conteneur`
  );
  console.log(
    `   ${colors.green}•${colors.reset} Indicateurs de charge par couleur (vert/jaune/rouge)`
  );
  console.log(
    `   ${colors.green}•${colors.reset} Alerte détaillée avec ${CONFIG.ALERT_PAUSE_DURATION}s de lecture`
  );
  console.log(`   ${colors.green}•${colors.reset} Compte à rebours visuel\n`);

  // Vérifier l'image
  try {
    await docker.getImage(CONFIG.IMAGE).inspect();
    console.log(
      `${colors.green}✅ Image ${CONFIG.IMAGE} trouvée${colors.reset}\n`
    );
  } catch (error) {
    console.log(
      `${colors.red}❌ Image ${CONFIG.IMAGE} non trouvée${colors.reset}`
    );
    console.log(`${colors.yellow}💡 Exécutez: npm run build${colors.reset}\n`);
    process.exit(1);
  }

  // Nettoyage initial
  await cleanup();

  console.log(
    `${colors.green}${colors.bright}🎬 Démarrage de la simulation dans 3 secondes...${colors.reset}\n`
  );
  await new Promise((r) => setTimeout(r, 3000));

  // Lancer la simulation
  setInterval(simulationLoop, CONFIG.SIMULATION_INTERVAL);
}

// Gestion de l'arrêt
process.on("SIGINT", async () => {
  console.log(`\n\n${colors.yellow}🛑 Arrêt demandé...${colors.reset}`);
  await cleanup();
  console.log(`${colors.green}👋 Au revoir !${colors.reset}\n`);
  process.exit(0);
});

// Lancer
start().catch((error) => {
  console.error(`${colors.red}❌ Erreur fatale:${colors.reset}`, error);
  process.exit(1);
});
