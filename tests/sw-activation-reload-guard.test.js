import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

describe('SW activation reload guard', () => {
  [
    {
      relPath: '../js/lf-app.js',
      reloadExpr: /window\.location\.reload\(\);/
    },
    {
      relPath: '../js/shell-lite.js',
      reloadExpr: /location\.reload\(\);/
    }
  ].forEach(({ relPath, reloadExpr }) => {
    it(path.basename(relPath) + ' only auto-reloads once before user interaction', () => {
      const code = fs.readFileSync(path.resolve(__dirname, relPath), 'utf8');
      expect(code).toMatch(/sessionStorage\.getItem\([^)]*(reloadGuardKey|sw_reload_guard_key)/i);
      expect(code).toMatch(/sessionStorage\.setItem\([^)]*(reloadGuardKey|sw_reload_guard_key)/i);
      expect(code).toMatch(/document\.visibilityState\s*===\s*'hidden'/);
      expect(code).toMatch(/Date\.now\(\)\s*>\s*.*sw.*reload.*deadline/i);
      expect(code).toMatch(/pointerdown/);
      expect(code).toMatch(/touchstart/);
      expect(code).toMatch(/controllerchange/);
      expect(code).toMatch(reloadExpr);
    });
  });
});
