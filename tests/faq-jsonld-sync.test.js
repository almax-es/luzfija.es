/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import { auditFaqJsonLdSync } from '../scripts/check-faq-jsonld-sync.mjs';

describe('FAQ visible ↔ FAQPage JSON-LD', () => {
  it('mantiene cada pregunta y respuesta visible idéntica en FAQPage', () => {
    const result = auditFaqJsonLdSync();
    expect(result.visiblePairs).toBeGreaterThan(0);
    expect(result.issues).toEqual([]);
  });
});
