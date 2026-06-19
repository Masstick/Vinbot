jest.mock('axios', () => ({ post: jest.fn().mockResolvedValue({ data: {} }) }));
import axios from 'axios';
import { TelegramService } from './telegram.service';

describe('TelegramService', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { ...originalEnv, TELEGRAM_BOT_TOKEN: 'test-token' };
    (axios.post as jest.Mock).mockClear();
  });
  afterAll(() => {
    process.env = originalEnv;
  });

  it('sendListingAlert routes to keyword.user.telegram_chat_id', async () => {
    const service = new TelegramService();
    const keyword = { label: 'k', user: { telegram_chat_id: '-555' } } as any;
    const listing = { title: 't', price: 10, url: 'http://x', vinted_id: 1 } as any;
    await service.sendListingAlert(listing, keyword, 'fr');
    expect(axios.post).toHaveBeenCalled();
    const url = (axios.post as jest.Mock).mock.calls[0][0];
    const body = (axios.post as jest.Mock).mock.calls[0][1];
    expect(url).toContain('test-token');
    expect(body.chat_id).toBe('-555');
  });

  it('sendListingAlert skips silently when the keyword owner has no chat_id', async () => {
    const service = new TelegramService();
    const keyword = { label: 'k', user: { telegram_chat_id: '' } } as any;
    const listing = { title: 't', price: 10, url: 'http://x', vinted_id: 1 } as any;
    await service.sendListingAlert(listing, keyword, 'fr');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('sendTest sends to the chat_id passed as a parameter', async () => {
    const service = new TelegramService();
    await service.sendTest('-999');
    const body = (axios.post as jest.Mock).mock.calls[0][1];
    expect(body.chat_id).toBe('-999');
  });
});
