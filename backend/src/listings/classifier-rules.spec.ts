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

  it('reconnaît une carte graphique Nvidia avec suffixe', () => {
    expect(classifyTitle('Carte graphique MSI RTX 3060 Ti Gaming')).toBe('GPU RTX 3060 Ti');
  });

  it('reconnaît une carte graphique AMD avec suffixe XT', () => {
    expect(classifyTitle('AMD RX 6600 XT 8GB')).toBe('GPU RX 6600 XT');
  });

  it('retourne null pour un GPU sans référence numérique', () => {
    expect(classifyTitle('Carte graphique Nvidia GTX en panne')).toBeNull();
  });

  it('reconnaît une carte mère avec son chipset', () => {
    expect(classifyTitle('Carte mère Asus PRIME B450-PLUS')).toBe('Carte mère B450');
  });

  it('retourne null pour une carte mère sans chipset reconnu', () => {
    expect(classifyTitle('Carte mère ASUS P8H67-M')).toBeNull();
  });

  it('reconnaît un SSD avec capacité en Go', () => {
    expect(classifyTitle('SSD Samsung 500GB 2.5"')).toBe('SSD 500GB');
  });

  it('reconnaît un SSD NVMe avec capacité en To', () => {
    expect(classifyTitle('SSD NVMe M.2 1TB Crucial')).toBe('NVMe 1TB');
  });

  it('reconnaît un disque dur avec capacité', () => {
    expect(classifyTitle('Disque dur HDD 2To Western Digital')).toBe('HDD 2TB');
  });

  it('retourne null pour un stockage sans capacité extractible', () => {
    expect(classifyTitle('SSD Samsung neuf sous blister')).toBeNull();
  });
});
