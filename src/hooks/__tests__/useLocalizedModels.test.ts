import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLocalizedModels } from '@/hooks/useLocalizedModels';

// ---- module mocks ----------------------------------------------------------

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// We mock both context hooks so the test never needs a full provider tree.
// useModel is mocked to return a well-known default model state.
vi.mock('@/contexts/useModel', () => ({
  useModel: vi.fn(() => ({
    selectedModel: 'hrnet',
    confidenceThreshold: 0.5,
    detectHoles: true,
    setSelectedModel: vi.fn(),
    setConfidenceThreshold: vi.fn(),
    setDetectHoles: vi.fn(),
    getModelInfo: vi.fn(),
    availableModels: [],
  })),
}));

// useLanguage is mocked with a simple passthrough t() so we can verify keys.
const mockT = vi.fn((key: string) => {
  // Provide realistic translations for model-related keys so the hook
  // returns non-empty strings for name/description.
  const translations: Record<string, string> = {
    'settings.modelSelection.models.hrnet.name': 'HRNet',
    'settings.modelSelection.models.hrnet.description':
      'Balanced model with good speed and quality',
    'settings.modelSelection.models.cbam.name': 'CBAM-ResUNet',
    'settings.modelSelection.models.cbam.description':
      'Most precise segmentation with attention mechanisms',
    'settings.modelSelection.models.unet_spherohq.name': 'UNet (SpheroHQ)',
    'settings.modelSelection.models.unet_spherohq.description':
      'Fastest model after optimizations',
    'settings.modelSelection.models.sperm.name': 'Sperm Segmentation',
    'settings.modelSelection.models.sperm.description':
      'Sperm morphology model with skeleton extraction',
  };
  return translations[key] ?? key;
});

vi.mock('@/contexts/useLanguage', () => ({
  useLanguage: vi.fn(() => ({
    t: mockT,
    language: 'en',
    setLanguage: vi.fn(),
    availableLanguages: ['en', 'cs', 'es', 'de', 'fr', 'zh'],
  })),
}));

// ---- tests -----------------------------------------------------------------

describe('useLocalizedModels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('return shape', () => {
    it('exposes selectedModel, confidenceThreshold, detectHoles and setters', () => {
      const { result } = renderHook(() => useLocalizedModels());

      expect(result.current.selectedModel).toBe('hrnet');
      expect(result.current.confidenceThreshold).toBe(0.5);
      expect(result.current.detectHoles).toBe(true);
      expect(typeof result.current.setSelectedModel).toBe('function');
      expect(typeof result.current.setConfidenceThreshold).toBe('function');
      expect(typeof result.current.setDetectHoles).toBe('function');
    });

    it('exposes getLocalizedModel, getAllModels, getSelectedModelInfo, availableModels', () => {
      const { result } = renderHook(() => useLocalizedModels());

      expect(typeof result.current.getLocalizedModel).toBe('function');
      expect(typeof result.current.getAllModels).toBe('function');
      expect(typeof result.current.getSelectedModelInfo).toBe('function');
      expect(Array.isArray(result.current.availableModels)).toBe(true);
    });
  });

  describe('getLocalizedModel', () => {
    it('returns localized name and description for hrnet', () => {
      const { result } = renderHook(() => useLocalizedModels());
      const info = result.current.getLocalizedModel('hrnet');

      expect(info.id).toBe('hrnet');
      expect(info.name).toBe('HRNet');
      expect(info.description).toContain('Balanced');
    });

    it('returns localized name and description for cbam_resunet', () => {
      const { result } = renderHook(() => useLocalizedModels());
      const info = result.current.getLocalizedModel('cbam_resunet');

      expect(info.id).toBe('cbam_resunet');
      expect(info.name).toBe('CBAM-ResUNet');
      expect(info.description).toContain('precise');
    });

    it('returns localized name and description for unet_spherohq', () => {
      const { result } = renderHook(() => useLocalizedModels());
      const info = result.current.getLocalizedModel('unet_spherohq');

      expect(info.id).toBe('unet_spherohq');
      expect(info.name).toBe('UNet (SpheroHQ)');
    });

    it('returns localized name and description for sperm', () => {
      const { result } = renderHook(() => useLocalizedModels());
      const info = result.current.getLocalizedModel('sperm');

      expect(info.id).toBe('sperm');
      expect(info.name).toBe('Sperm Segmentation');
    });
  });

  describe('getAllModels', () => {
    it('returns every registered model (spheroid + sperm + wound)', () => {
      const { result } = renderHook(() => useLocalizedModels());
      const models = result.current.getAllModels();

      // Registry: hrnet, cbam_resunet, unet_spherohq, unet_attention_aspp,
      // sperm, wound. If this count changes intentionally, update here.
      expect(models).toHaveLength(6);
      const ids = models.map(m => m.id);
      expect(ids).toContain('hrnet');
      expect(ids).toContain('cbam_resunet');
      expect(ids).toContain('unet_spherohq');
      expect(ids).toContain('unet_attention_aspp');
      expect(ids).toContain('sperm');
      expect(ids).toContain('wound');
    });

    it('each model has a non-empty name and description', () => {
      const { result } = renderHook(() => useLocalizedModels());
      const models = result.current.getAllModels();

      models.forEach(m => {
        expect(m.name.length).toBeGreaterThan(0);
        expect(m.description.length).toBeGreaterThan(0);
      });
    });
  });

  describe('getSelectedModelInfo', () => {
    it('returns info for the currently selected model (hrnet)', () => {
      const { result } = renderHook(() => useLocalizedModels());
      const info = result.current.getSelectedModelInfo();

      expect(info.id).toBe('hrnet');
      expect(info.name).toBe('HRNet');
    });
  });

  describe('availableModels', () => {
    it('availableModels is pre-populated at render time', () => {
      const { result } = renderHook(() => useLocalizedModels());

      // availableModels is the result of getAllModels() called during render
      expect(result.current.availableModels).toHaveLength(6);
    });
  });

  describe('fallback when translation key is missing', () => {
    it('returns the raw translation key when t() does not find a translation', () => {
      // Override mockT to return the key unchanged for this test
      mockT.mockImplementation((key: string) => key);

      const { result } = renderHook(() => useLocalizedModels());
      const info = result.current.getLocalizedModel('hrnet');

      // When t() falls back, name equals the translation key itself
      expect(info.name).toBe('settings.modelSelection.models.hrnet.name');
      expect(info.description).toBe(
        'settings.modelSelection.models.hrnet.description'
      );
    });
  });
});
