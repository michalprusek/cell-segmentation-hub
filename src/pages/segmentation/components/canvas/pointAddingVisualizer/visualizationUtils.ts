
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
      fill: "#FFA500",
      stroke: "#FFFFFF"
    },
    hoverPoint: {
      fill: "#FFC107",
      stroke: "#FFA000"
    },
    potentialEndpoint: {
      fill: "#FFEB3B80",
      stroke: "#FFC107"
    },
    tempPoint: {
      fill: "#3498db",
      stroke: "#FFFFFF"
    },
    tempLine: {
      stroke: "#3498db"
    },
    cursorLine: {
      normal: "#3498db",
      endpoint: "#4CAF50"
    }
  };
};
