import { describe, it, expect, beforeAll } from 'vitest';
import '../js/lf-utils.js'; // Dependencia
import '../js/lf-csv-import.js';

describe('Lógica CSV - Calendario y Festivos', () => {
  let helpers;

  beforeAll(() => {
    helpers = window.LF.csvHelpers;
  });

  describe('Detección de Festivos Nacionales', () => {
    it('Debe detectar festivos fijos (Navidad, Año Nuevo)', () => {
      // Navidad 2025 (Jueves)
      const navidad = new Date(2025, 11, 25); // Mes 11 es Diciembre
      const periodo = helpers.getPeriodoHorarioCSV(navidad, 12); // 12:00
      
      // Debe ser Valle (P3)
      expect(periodo).toBe('P3');
    });

    it('Debe detectar festivos móviles (Viernes Santo)', () => {
      // Viernes Santo 2025 es el 18 de Abril
      // (Pascua es el 20 de Abril de 2025)
      const viernesSanto = new Date(2025, 3, 18); // Mes 3 es Abril
      const periodo = helpers.getPeriodoHorarioCSV(viernesSanto, 10);
      
      expect(periodo).toBe('P3');
    });

    it('NO debe marcar como festivo un día laborable normal', () => {
      // 16 de Abril 2025 (Miércoles Santo - Laborable)
      const miercoles = new Date(2025, 3, 16);
      const periodo = helpers.getPeriodoHorarioCSV(miercoles, 12); // 12:00 es Punta
      
      expect(periodo).toBe('P1');
    });
  });

  describe('Clasificación Horaria (2.0TD)', () => {
    // Laborable (ej: Lunes 14 Abril 2025)
    const lunes = new Date(2025, 3, 14);

    it('Hora Punta (10h-14h)', () => {
      expect(helpers.getPeriodoHorarioCSV(lunes, 11)).toBe('P1');
    });

    it('Hora Llano (8h-10h)', () => {
      expect(helpers.getPeriodoHorarioCSV(lunes, 9)).toBe('P2');
    });

    it('Hora Valle (0h-8h)', () => {
      expect(helpers.getPeriodoHorarioCSV(lunes, 5)).toBe('P3');
    });

    it('Fin de semana siempre es Valle', () => {
      const domingo = new Date(2025, 3, 20);
      expect(helpers.getPeriodoHorarioCSV(domingo, 12)).toBe('P3'); // 12:00 Punta entre semana -> Valle finde
    });
  });
});
