/**
 * Configuration and validation for pixel-to-micrometer scale conversion
 */

export const SCALE_CONFIG = {
  // Valid range for scale values
  MIN_SCALE: 0.001,
  MAX_SCALE: 1000,
  
  // Warning thresholds
  HIGH_SCALE_WARNING: 100,
  LOW_SCALE_WARNING: 0.01,
  
  // Common microscopy scales for reference
  TYPICAL_SCALES: {
    '4x_objective': 1.6,    // ~1.6 pixels/µm
    '10x_objective': 4.0,   // ~4.0 pixels/µm
    '20x_objective': 8.0,   // ~8.0 pixels/µm
    '40x_objective': 16.0,  // ~16.0 pixels/µm
    '60x_objective': 24.0,  // ~24.0 pixels/µm
    '100x_objective': 40.0, // ~40.0 pixels/µm
  },
  
  // Precision for rounding
  AREA_PRECISION: 4,      // Decimal places for area measurements
  LINEAR_PRECISION: 3,     // Decimal places for linear measurements
} as const;

/**
 * Generate descriptive error message for invalid scale values
 */
export function getScaleValidationMessage(scale: number): string {
  if (!scale || scale === 0) {
    return `Invalid scale value (${scale}). Scale must be a positive number representing pixels per micrometer. Common values range from 0.1 to 50 pixels/µm depending on microscope magnification.`;
  }
  
  if (scale < 0) {
    return `Negative scale value (${scale}) is not allowed. Scale must be positive, representing pixels per micrometer.`;
  }
  
  if (!isFinite(scale)) {
    return `Invalid scale value (${isNaN(scale) ? 'NaN' : 'Infinity'}). Please provide a finite positive number for pixels per micrometer.`;
  }
  
  if (scale > SCALE_CONFIG.MAX_SCALE) {
    return `Scale value ${scale} pixels/µm exceeds maximum allowed value (${SCALE_CONFIG.MAX_SCALE}). This is unusually high for microscopy. Please verify your calibration.`;
  }
  
  if (scale < SCALE_CONFIG.MIN_SCALE) {
    return `Scale value ${scale} pixels/µm is below minimum allowed value (${SCALE_CONFIG.MIN_SCALE}). This is unusually low for microscopy. Please verify your calibration.`;
  }
  
  return '';
}

/**
 * Generate warning message for unusual but valid scale values
 */
export function getScaleWarningMessage(scale: number): string {
  if (scale > SCALE_CONFIG.HIGH_SCALE_WARNING) {
    const closestObjective = findClosestTypicalScale(scale);
    return `High scale value detected: ${scale} pixels/µm. This is higher than typical microscopy scales. ` +
           `Common scales range from ${SCALE_CONFIG.TYPICAL_SCALES['4x_objective']} (4x objective) to ` +
           `${SCALE_CONFIG.TYPICAL_SCALES['100x_objective']} (100x objective) pixels/µm. ` +
           `Your value might correspond to a very high magnification or a calibration error. Please verify.`;
  }
  
  if (scale < SCALE_CONFIG.LOW_SCALE_WARNING) {
    return `Low scale value detected: ${scale} pixels/µm. This is lower than typical microscopy scales. ` +
           `This might indicate very low magnification or large pixel size. ` +
           `Common scales range from ${SCALE_CONFIG.TYPICAL_SCALES['4x_objective']} to ` +
           `${SCALE_CONFIG.TYPICAL_SCALES['100x_objective']} pixels/µm. Please verify your calibration.`;
  }
  
  return '';
}

/**
 * Find the closest typical microscopy scale for reference
 */
function findClosestTypicalScale(scale: number): string {
  let closestKey = '4x_objective';
  let closestDiff = Math.abs(scale - SCALE_CONFIG.TYPICAL_SCALES['4x_objective']);
  
  for (const [key, value] of Object.entries(SCALE_CONFIG.TYPICAL_SCALES)) {
    const diff = Math.abs(scale - value);
    if (diff < closestDiff) {
      closestDiff = diff;
      closestKey = key;
    }
  }
  
  return closestKey.replace('_', ' ').replace('objective', 'objective magnification');
}

/**
 * Validate and normalize scale value
 */
export function validateScale(scale: number | undefined): { 
  valid: boolean; 
  value: number | undefined; 
  error?: string; 
  warning?: string;
} {
  if (scale === undefined || scale === null) {
    return { valid: true, value: undefined };
  }
  
  const errorMessage = getScaleValidationMessage(scale);
  if (errorMessage) {
    return { 
      valid: false, 
      value: undefined, 
      error: errorMessage 
    };
  }
  
  const warningMessage = getScaleWarningMessage(scale);
  
  return { 
    valid: true, 
    value: scale,
    warning: warningMessage || undefined
  };
}