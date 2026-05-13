export function isMicrotubuleInstance(
  instanceId: string | undefined | null
): boolean {
  return typeof instanceId === 'string' && instanceId.startsWith('mt_');
}

export function colorFromInstanceId(
  instanceId: string,
  { selected = false }: { selected?: boolean } = {}
): string {
  let hash = 0;
  for (let i = 0; i < instanceId.length; i++) {
    hash = ((hash << 5) - hash + instanceId.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  const sat = selected ? 80 : 70;
  const light = selected ? 45 : 55;
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}
