
/**
 * Utility funkce pro vizualizaci bodů
 */

/**
 * Dynamicky vypočítá velikost bodu podle úrovně zoomu - OBRÁCENĚ
 */
export const getPointRadius = (zoom: number): number => {
  if (zoom > 4) {
    // Při extrémním přiblížení (zoom > 4) ZVĚTŠÍME body
    return 8 / zoom;
  } else if (zoom > 3) {
    // Při velkém přiblížení (zoom > 3) zvětšíme body
    return 7 / zoom;
  } else if (zoom < 0.5) {
    // Při velkém oddálení (zoom < 0.5) ZMENŠÍME body výrazně
    return 4 / zoom;
  } else if (zoom < 0.7) {
    // Při mírném oddálení (zoom < 0.7) zmenšíme body
    return 5 / zoom;
  } else {
    // Normální velikost pro běžný zoom
    return 6 / zoom;
  }
};

/**
 * Dynamicky vypočítá tloušťku čáry podle úrovně zoomu - OBRÁCENĚ
 */
export const getStrokeWidth = (zoom: number): number => {
  if (zoom > 4) return 3/zoom;
  if (zoom > 3) return 2.5/zoom;
  if (zoom < 0.5) return 1.8/zoom;
  if (zoom < 0.7) return 2/zoom;
  return 2.2/zoom;
};

/**
 * Vrátí barvy pro vizualizaci
 */
export const getColors = () => ({
  startPoint: {
    fill: '#FFA500', // orange
    stroke: '#FF8C00', // dark orange
    glowColor: 'rgba(255, 165, 0, 0.4)' // transparent orange
  },
  hoverPoint: {
    fill: '#FFC107', // amber
    stroke: '#FFA000', // amber darken-2
    glowColor: 'rgba(255, 193, 7, 0.4)' // transparent amber
  },
  tempPoint: {
    fill: '#3498db', // blue
    stroke: '#2980b9', // dark blue
    glowColor: 'rgba(52, 152, 219, 0.4)' // transparent blue
  }
});
