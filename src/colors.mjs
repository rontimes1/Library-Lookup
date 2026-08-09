// Level -> spine color mapping. Fully configurable; this is just the default
// (the school scheme from the reference sheet). Bands are inclusive of min/max.

export const DEFAULT_COLOR_SCHEME = {
  field: 'atosBookLevel',
  bands: [
    { min: 0.1, max: 1.9, color: '#E8912A', label: 'Orange' },
    { min: 2.0, max: 2.9, color: '#3AA757', label: 'Green' },
    { min: 3.0, max: 3.9, color: '#F4D000', label: 'Yellow' },
    { min: 4.0, max: 4.9, color: '#2E7CD6', label: 'Blue' },
    { min: 5.0, max: 5.9, color: '#E23B2E', label: 'Red' },
    { min: 6.0, max: 6.9, color: '#3A2E2A', label: 'Black' },
    { min: 7.0, max: 999, color: '#EE9BB8', label: 'Pink' },
  ],
};

// Returns { color, colorLabel } or nulls if the value is missing/out of range.
export function colorFor(book, scheme = DEFAULT_COLOR_SCHEME) {
  const v = book?.[scheme.field];
  if (typeof v !== 'number' || Number.isNaN(v)) return { color: null, colorLabel: null };
  const band = scheme.bands.find((b) => v >= b.min && v <= b.max);
  return band
    ? { color: band.color, colorLabel: band.label }
    : { color: null, colorLabel: null };
}
