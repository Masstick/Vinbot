import { classifyTitle } from './classifier-rules';

describe('classifyTitle', () => {
  it('reconnaît une barrette RAM DDR3 avec capacité', () => {
    expect(classifyTitle('16GB DDR3 Corsair xms CMX8GX3M2A1333C9')).toBe('RAM DDR3 16GB');
  });

  it('reconnaît une RAM DDR4 même avec un texte multilingue autour', () => {
    expect(classifyTitle('Kit 16GB ddr4 , 2 modulos de 8GB')).toBe('RAM DDR4 16GB');
  });

  it('reconnaît un CPU avec référence séparée par un espace', () => {
    expect(classifyTitle('Intel Core i7 4790K')).toBe('CPU i7-4790K');
  });

  it('reconnaît un CPU avec référence séparée par un tiret', () => {
    expect(classifyTitle('Processeur i5-2450M')).toBe('CPU i5-2450M');
  });

  it('retourne null pour un titre hors périmètre', () => {
    expect(classifyTitle('Lampadario a ventilatore')).toBeNull();
  });

  it('retourne null pour une RAM sans capacité extractible', () => {
    expect(classifyTitle('RAM DDR3')).toBeNull();
  });
});
