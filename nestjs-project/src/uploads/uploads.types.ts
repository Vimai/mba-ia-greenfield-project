import type { IncomingMessage } from 'http';

export type TusRequest = IncomingMessage & { channelId?: string };
