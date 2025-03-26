
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
      innerFill: "#FFFFFF" // Bílá pro vnitřní kruh
    },
    hoverPoint: {
      fill: "#FFC107",     // Žlutá - při hoveru
      stroke: "#FF9800"    // Tmavší oranžová
    },
    potentialEndpoint: {
      fill: "rgba(255, 235, 59, 0.5)", // Poloprůhledná žlutá
      stroke: "#FFC107"                // Žlutá
    },
    tempPoint: {
      fill: "#2196F3",     // Modrá
      stroke: "#FFFFFF"    // Bílá
    },
    tempLine: {
      stroke: "#2196F3"    // Modrá
    },
    cursorLine: {
      normal: "#64B5F6",   // Světlejší modrá
      endpoint: "#4CAF50"  // Zelená pro koncový bod
    }
  };
};
