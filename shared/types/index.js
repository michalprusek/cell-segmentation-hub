'use strict';
/**
 * Sdílené typy mezi frontend a backend
 */
Object.defineProperty(exports, '__esModule', { value: true });
exports.SEGMENTATION_MODELS = void 0;
// Available segmentation models
exports.SEGMENTATION_MODELS = {
  hrnet: {
    id: 'hrnet',
    name: 'HRNetV2',
    description: 'High-Resolution Network for semantic segmentation',
    defaultThreshold: 0.5,
  },
  resunet_advanced: {
    id: 'resunet_advanced',
    name: 'ResUNet Advanced',
    description: 'Advanced ResUNet with attention mechanisms',
    defaultThreshold: 0.6,
  },
  resunet_small: {
    id: 'resunet_small',
    name: 'ResUNet Small',
    description: 'Efficient ResUNet for fast segmentation',
    defaultThreshold: 0.7,
  },
};
//# sourceMappingURL=index.js.map
