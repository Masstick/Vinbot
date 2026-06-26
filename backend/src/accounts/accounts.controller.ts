import { Controller, Get, Post } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { VintedConnectService } from './vinted-connect.service';

@Controller('accounts')
export class AccountsController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly connect: VintedConnectService,
  ) {}

  @Get('status')
  async status() {
    const acc = await this.accounts.getAccount();
    if (!acc) return { connected: false, status: 'none' as const };
    return {
      connected: acc.status === 'connected',
      status: acc.status,
      label: acc.label,
      vinted_user_id: acc.vinted_user_id ?? undefined,
      connected_at: acc.connected_at ?? undefined,
    };
  }

  @Post('connect/start')
  start() {
    return this.connect.startConnect();
  }

  @Post('connect/poll')
  poll() {
    return this.connect.detectAndCapture();
  }
}
