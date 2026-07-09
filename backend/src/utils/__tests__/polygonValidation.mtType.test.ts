import { PolygonValidator } from '../polygonValidation';

describe('mtType field preservation', () => {
  const polyline = (extra: Record<string, unknown>) =>
    JSON.stringify([
      {
        id: 'p1',
        geometry: 'polyline',
        points: [
          { x: 0, y: 0 },
          { x: 5, y: 5 },
        ],
        ...extra,
      },
    ]);

  it('preserves a non-empty mtType through validation', () => {
    const { polygons, isValid } = PolygonValidator.parsePolygonData(
      polyline({ mtType: 'mt_type_abc123' }),
      'test'
    );
    expect(isValid).toBe(true);
    expect((polygons[0] as { mtType?: string }).mtType).toBe('mt_type_abc123');
  });

  it('drops an empty-string mtType', () => {
    const { polygons } = PolygonValidator.parsePolygonData(
      polyline({ mtType: '' }),
      'test'
    );
    expect((polygons[0] as { mtType?: string }).mtType).toBeUndefined();
  });

  it('drops a non-string mtType', () => {
    const { polygons } = PolygonValidator.parsePolygonData(
      polyline({ mtType: 42 }),
      'test'
    );
    expect((polygons[0] as { mtType?: string }).mtType).toBeUndefined();
  });
});
