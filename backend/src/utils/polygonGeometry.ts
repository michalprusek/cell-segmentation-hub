export interface Point {
  x: number;
  y: number;
}

export const polylineLength = (points: Point[]): number => {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (prev && curr) {
      const dx = curr.x - prev.x;
      const dy = curr.y - prev.y;
      length += Math.sqrt(dx * dx + dy * dy);
    }
  }
  return length;
};
