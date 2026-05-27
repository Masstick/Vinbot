import { MistralService } from './mistral.service';
import { ConfigService } from '@nestjs/config';

function makeService(key?: string): MistralService {
  const cfg = { get: jest.fn().mockReturnValue(key) } as unknown as ConfigService;
  const svc = new MistralService(cfg);
  svc.onModuleInit();
  return svc;
}

describe('MistralService', () => {
  describe('when API key is absent', () => {
    it('is disabled', () => {
      const svc = makeService(undefined);
      expect(svc.isEnabled()).toBe(false);
    });

    it('extractModel returns null model_label', async () => {
      const svc = makeService(undefined);
      const result = await svc.extractModel('Intel Core i7-12700K', 150);
      expect(result).toEqual({ model_label: null, confidence: 0 });
    });

    it('analyzeDeal returns null', async () => {
      const svc = makeService(undefined);
      const result = await svc.analyzeDeal({} as any, {} as any, 100, 5);
      expect(result).toBeNull();
    });
  });

  describe('parseExtractResponse', () => {
    it('parses valid JSON correctly', () => {
      const svc = makeService(undefined);
      const result = (svc as any).parseExtractResponse(
        JSON.stringify({ model_label: 'Intel Core i7-12700K', confidence: 0.95 })
      );
      expect(result).toEqual({ model_label: 'Intel Core i7-12700K', confidence: 0.95 });
    });

    it('handles null model_label', () => {
      const svc = makeService(undefined);
      const result = (svc as any).parseExtractResponse(
        JSON.stringify({ model_label: null, confidence: 0 })
      );
      expect(result).toEqual({ model_label: null, confidence: 0 });
    });

    it('returns null on invalid JSON', () => {
      const svc = makeService(undefined);
      const result = (svc as any).parseExtractResponse('not json');
      expect(result).toEqual({ model_label: null, confidence: 0 });
    });
  });

  describe('parseAnalysisResponse', () => {
    it('parses valid analysis JSON', () => {
      const svc = makeService(undefined);
      const json = JSON.stringify({
        scam_risk: 'low', confidence: 0.9, recommendation: 'buy',
        reasoning: 'Prix attractif pour ce modèle.',
      });
      const result = (svc as any).parseAnalysisResponse(json);
      expect(result.recommendation).toBe('buy');
      expect(result.scam_risk).toBe('low');
    });

    it('sanitizes unknown recommendation to skip', () => {
      const svc = makeService(undefined);
      const json = JSON.stringify({
        scam_risk: 'low', confidence: 0.5, recommendation: 'maybe',
        reasoning: 'Incertain.',
      });
      const result = (svc as any).parseAnalysisResponse(json);
      expect(result.recommendation).toBe('skip');
    });
  });
});
