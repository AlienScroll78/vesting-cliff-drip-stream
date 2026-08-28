export function validateAddress(value: string): string {
  if (!value || typeof value !== 'string') {
    throw new Error('Invalid Stellar address');
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Invalid Stellar address');
  }

  const isValid = /^[G][A-Z2-7]{55}$/.test(trimmed);
  if (!isValid) {
    throw new Error('Invalid Stellar address');
  }

  return trimmed;
}
