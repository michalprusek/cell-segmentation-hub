/**
 * Configuration and validation for pixel-to-micrometer scale conversion
 */

export const SCALE_CONFIG = {
  // Valid range for scale values (um/pixel)
  MIN_SCALE: 0.001,  // Very high magnification
  MAX_SCALE: 1000,   // Very low magnification

  // Warning thresholds (um/pixel)
  HIGH_SCALE_WARNING: 1,    // Above 1 um/pixel (very low magnification)
  LOW_SCALE_WARNING: 0.01,  // Below 0.01 um/pixel (very high magnification)

  // Common microscopy scales for reference (um/pixel)
  TYPICAL_SCALES: {
    '4x_objective': 0.625,  // ~0.625 um/pixel (1/1.6)
    '10x_objective': 0.25,  // ~0.25 um/pixel (1/4.0)
    '20x_objective': 0.125, // ~0.125 um/pixel (1/8.0)
    '40x_objective': 0.0625,// ~0.0625 um/pixel (1/16.0)
    '60x_objective': 0.042, // ~0.042 um/pixel (1/24.0)
    '100x_objective': 0.025,// ~0.025 um/pixel (1/40.0)
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
    return `Invalid scale value (${scale}). Scale must be a positive number representing micrometers per pixel. Common values range from 0.01 to 2 um/pixel depending on microscope magnification.`;
  }
  
  if (scale < 0) {
    return `Negative scale value (${scale}) is not allowed. Scale must be positive, representing micrometers per pixel.`;
  }
  
  if (!isFinite(scale)) {
    return `Invalid scale value (${isNaN(scale) ? 'NaN' : 'Infinity'}). Please provide a finite positive number for micrometers per pixel.`;
  }
  
  if (scale > SCALE_CONFIG.MAX_SCALE) {
    return `Scale value ${scale} um/pixel exceeds maximum allowed value (${SCALE_CONFIG.MAX_SCALE}). This is unusually high for microscopy. Please verify your calibration.`;
  }
  
  if (scale < SCALE_CONFIG.MIN_SCALE) {
    return `Scale value ${scale} um/pixel is below minimum allowed value (${SCALE_CONFIG.MIN_SCALE}). This is unusually low for microscopy. Please verify your calibration.`;
  }
  
  return '';
}

/**
 * Generate warning message for unusual but valid scale values
 */
export function getScaleWarningMessage(scale: number): string {
  if (scale > SCALE_CONFIG.HIGH_SCALE_WARNING) {
    const _closestObjective = findClosestTypicalScale(scale);
    return `High scale value detected: ${scale} um/pixel. This is higher than typical microscopy scales. ` +
           `Common scales range from ${SCALE_CONFIG.TYPICAL_SCALES['100x_objective']} (100x objective) to ` +
           `${SCALE_CONFIG.TYPICAL_SCALES['4x_objective']} (4x objective) um/pixel. ` +
           `Your value might correspond to very low magnification or a calibration error. Please verify.`;
  }
  
  if (scale < SCALE_CONFIG.LOW_SCALE_WARNING) {
    return `Low scale value detected: ${scale} um/pixel. This is lower than typical microscopy scales. ` +
           `This might indicate very high magnification or small pixel size. ` +
           `Common scales range from ${SCALE_CONFIG.TYPICAL_SCALES['100x_objective']} to ` +
           `${SCALE_CONFIG.TYPICAL_SCALES['4x_objective']} um/pixel. Please verify your calibration.`;
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