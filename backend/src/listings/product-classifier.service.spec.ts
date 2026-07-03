jest.mock('axios');
import axios from 'axios';
import { ProductClassifierService } from './product-classifier.service';

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ProductClassifierService', () => {
  describe('classifyByRules', () => {
    it('délègue à classifyTitle', () => {
      const config: any = { get: jest.fn().mockReturnValue('') };
      const svc = new ProductClassifierService(config);
      expect(svc.classifyByRules('Processeur i5-2450M')).toBe('CPU i5-2450M');
      expect(svc.classifyByRules('Lampadario a ventilatore')).toBeNull();
    });
  });

  describe('classifyWithMistral', () => {
    it('retourne null immédiatement si MISTRAL_API_KEY est absent', async () => {
      const config: any = { get: jest.fn().mockReturnValue('') };
      const svc = new ProductClassifierService(config);
      const result = await svc.classifyWithMistral('Carte mère ASUS P8H67-M');
      expect(result).toBeNull();
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('retourne le type de produit renvoyé par Mistral', async () => {
      const config: any = { get: jest.fn().mockReturnValue('fake-key') };
      mockedAxios.post.mockResolvedValue({
        data: { choices: [{ message: { content: 'Carte mère ATX' } }] },
      });
      const svc = new ProductClassifierService(config);
      const result = await svc.classifyWithMistral('Scheda Madre ASUS P8H67-M');
      expect(result).toBe('Carte mère ATX');
    });

    it('retourne null si Mistral répond INCONNU', async () => {
      const config: any = { get: jest.fn().mockReturnValue('fake-key') };
      mockedAxios.post.mockResolvedValue({
        data: { choices: [{ message: { content: 'INCONNU' } }] },
      });
      const svc = new ProductClassifierService(config);
      const result = await svc.classifyWithMistral('Lampadario a ventilatore');
      expect(result).toBeNull();
    });

    it('retourne null si l’appel Mistral échoue', async () => {
      const config: any = { get: jest.fn().mockReturnValue('fake-key') };
      mockedAxios.post.mockRejectedValue(new Error('timeout'));
      const svc = new ProductClassifierService(config);
      const result = await svc.classifyWithMistral('Ventilateur Noctua NF-A9');
      expect(result).toBeNull();
    });
  });
});
