
/**
 * Utility funkce pro výpočet tloušťky čáry podle úrovně přiblížení
 */
export const getStrokeWidth = (zoom: number): number => {
  if (zoom > 4) return 3/zoom;
  if (zoom > 3) return 2.5/zoom;
  if (zoom < 0.5) return 1.2/zoom;
  if (zoom < 0.7) return 1.5/zoom;
  return 2/zoom;
};

/**
 * Utility funkce pro výpočet velikosti bodů podle úrovně přiblížení
 */
export const getPointRadius = (zoom: number): number => {
  if (zoom > 4) return 7/zoom;
  if (zoom > 3) return 6/zoom;
  if (zoom < 0.5) return 4/zoom;
  if (zoom < 0.7) return 4.5/zoom;
  return 5/zoom;
};

/**
 * Utility funkce pro získání barvy podle stavu
 */
export const getColors = () => {
  return {
    startPoint: {
      fill: "#FF5722",     // Oranžová - výraznější
      stroke: "#FFFFFF",
      innerFill: "#FFFFFF", // Bílá pro vnitřní kruh
      glowColor: "rgba(255, 87, 34, 0.5)" // Oranžová záře
    },
    endPoint: {
      fill: "#4CAF50",     // Zelená pro koncový bod
      stroke: "#FFFFFF",
      glowColor: "rgba(76, 175, 80, 0.5)" // Zelená záře
    },
    hoverPoint: {
      fill: "#FFC107",     // Žlutá - při hoveru
      stroke: "#FF9800",   // Tmavší oranžová
      glowColor: "rgba(255, 193, 7, 0.5)" // Žlutá záře
    },
    potentialEndpoint: {
      fill: "rgba(255, 235, 59, 0.7)", // Méně průhledná žlutá
      stroke: "#FFC107",              // Žlutá
      hovered: {
        fill: "#FFEB3B",              // Jasná žlutá
        stroke: "#FFA000",            // Tmavší žlutá
        glowColor: "rgba(255, 235, 59, 0.6)" // Žlutá záře
      }
    },
    tempPoint: {
      fill: "#2196F3",     // Modrá
      stroke: "#FFFFFF",   // Bílá
      glowColor: "rgba(33, 150, 243, 0.5)" // Modrá záře
    },
    tempLine: {
      stroke: "#2196F3",    // Modrá
      dashStroke: "#64B5F6" // Světlejší modrá pro čárkovanou čáru
    },
    cursorLine: {
      normal: "#64B5F6",   // Světlejší modrá
      endpoint: "#4CAF50", // Zelená pro koncový bod
      dashArray: "5,5"     // Vzor pro čárkovanou čáru (5px čára, 5px mezera)
    }
  };
};
