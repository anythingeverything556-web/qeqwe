export interface TwitchMessage {
  id: string;
  user: string;
  message: string;
  timestamp: Date;
  isSubscriber: boolean;
  isMod: boolean;
  isVip: boolean;
  isBroadcaster: boolean;
  isTTS: boolean;
  cleanMessage: string;
}

export interface TwitchClientOptions {
  channel: string;
  onMessage: (msg: TwitchMessage) => void;
  onStatusChange: (status: 'disconnected' | 'connecting' | 'connected', channel: string) => void;
  onLog: (log: string) => void;
  onLatencyUpdate?: (latencyMs: number) => void;
}

export class TwitchIRCClient {
  private ws: WebSocket | null = null;
  private channel: string;
  private onMessage: (msg: TwitchMessage) => void;
  private onStatusChange: (status: 'disconnected' | 'connecting' | 'connected', channel: string) => void;
  private onLog: (log: string) => void;
  private keepAliveInterval: any = null;
  private healthCheckInterval: any = null;
  private reconnectTimeout: any = null;
  private intentionallyDisconnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 20;
  private onLatencyUpdate?: (latencyMs: number) => void;
  private lastPingTime: number = 0;
  private lastMessageTime: number = Date.now();
  private channelName: string = '';

  constructor(options: TwitchClientOptions) {
    this.channel = options.channel.trim().toLowerCase();
    this.onMessage = options.onMessage;
    this.onStatusChange = options.onStatusChange;
    this.onLog = options.onLog;
    this.onLatencyUpdate = options.onLatencyUpdate;
  }

  public connect() {
    this.intentionallyDisconnected = false;
    if (this.ws) {
      this.disconnect();
    }

    this.channelName = this.channel.startsWith('#') ? this.channel.substring(1) : this.channel;
    if (!this.channelName) {
      this.onLog('Error: Twitch Channel name is empty.');
      return;
    }

    this.onLog(`[System] Connecting to Twitch IRC for #${this.channelName}...`);
    this.onStatusChange('connecting', this.channelName);

    try {
      this.ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');

      this.ws.onopen = () => {
        if (!this.ws) return;
        this.reconnectAttempts = 0;
        this.lastMessageTime = Date.now();
        this.onLog('[System] WebSocket opened. Authenticating...');
        this.ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands twitch.tv/membership');
        const anonNick = `justinfan${Math.floor(10000 + Math.random() * 90000)}`;
        this.ws.send('PASS SCHMOOPIE');
        this.ws.send(`NICK ${anonNick}`);
        this.ws.send(`JOIN #${this.channelName}`);
        this.onLog(`[System] Signed in as ${anonNick}. Joining #${this.channelName}...`);

        this.keepAliveInterval = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.lastPingTime = Date.now();
            try { this.ws.send('PING :tmi.twitch.tv'); } catch {}
          }
        }, 30000);

        this.healthCheckInterval = setInterval(() => {
          const silenceMs = Date.now() - this.lastMessageTime;
          if (silenceMs > 90000 && !this.intentionallyDisconnected) {
            this.onLog(`[System] No data for ${Math.round(silenceMs / 1000)}s — dead connection. Force-reconnecting...`);
            this.forceReconnect();
          }
        }, 30000);
      };

      this.ws.onmessage = (event) => {
        this.lastMessageTime = Date.now();
        const rawData = event.data as string;
        const lines = rawData.split('\r\n');

        lines.forEach((line) => {
          if (!line) return;

          if (line.startsWith('PING ')) {
            this.ws?.send(line.replace('PING', 'PONG'));
            // BUG FIX: Do NOT set lastPingTime or calculate latency here.
            // lastPingTime tracks when WE sent our own PING, so we can measure
            // round-trip latency when the PONG comes back. Overwriting it on a
            // received PING from Twitch corrupts the measurement — the next PONG
            // would calculate latency from when Twitch's PING arrived, not from
            // when we sent our own PING.
            return;
          }

          if (line.startsWith(':tmi.twitch.tv PONG ') || line.startsWith('PONG ')) {
            if (this.lastPingTime > 0) {
              const latency = Date.now() - this.lastPingTime;
              this.onLatencyUpdate?.(latency);
              this.lastPingTime = 0;
            }
            return;
          }

          if (line.startsWith(':tmi.twitch.tv RECONNECT')) {
            this.onLog('[System] Twitch requested RECONNECT. Reconnecting immediately...');
            this.forceReconnect();
            return;
          }

          if (line.includes(` JOIN #${this.channelName}`)) {
            this.onLog(`[System] Connected to #${this.channelName}! Listening for messages...`);
            this.onStatusChange('connected', this.channelName);
            return;
          }

          if (line.includes('Login authentication failed')) {
            this.onLog('[System Error] Twitch login failed. Will not reconnect.');
            this.intentionallyDisconnected = true;
            this.disconnect();
            return;
          }

          if (line.includes(' PRIVMSG #')) {
            try {
              const parts = line.split(' PRIVMSG #');
              if (parts.length < 2) return;
              const rightSide = parts[1];
              const channelNameEnd = rightSide.indexOf(' :');
              if (channelNameEnd === -1) return;
              const messageText = rightSide.substring(channelNameEnd + 2);

              let displayName = '';
              let isSub = false;
              let isMod = false;
              let isVip = false;
              let isBroadcaster = false;

              const leftSide = parts[0];
              if (leftSide.startsWith('@')) {
                const tagsStr = leftSide.substring(1);
                const tags = tagsStr.split(';');
                const tagMap: Record<string, string> = {};
                tags.forEach((t) => {
                  const equalIdx = t.indexOf('=');
                  if (equalIdx !== -1) {
                    const key = t.substring(0, equalIdx);
                    const val = t.substring(equalIdx + 1);
                    tagMap[key] = val || '';
                  }
                });
                displayName = tagMap['display-name'] || '';
                isSub = tagMap['subscriber'] === '1';
                isMod = tagMap['mod'] === '1';
                isVip = !!(tagMap['vip'] === '1' || (tagMap['badges'] && tagMap['badges'].includes('vip/')));
                isBroadcaster = !!(tagMap['badges'] && tagMap['badges'].includes('broadcaster/'));
              }

              if (!displayName) {
                const userMatch = line.match(/:([^!]+)!/);
                displayName = userMatch ? userMatch[1] : 'Anonymous';
              }
              if (isBroadcaster) isMod = true;

              const chatMsg: TwitchMessage = {
                id: Date.now().toString(36) + Math.random().toString(36).slice(2, 9),
                user: displayName,
                message: messageText,
                timestamp: new Date(),
                isSubscriber: isSub,
                isMod: isMod,
                isVip: isVip,
                isBroadcaster: isBroadcaster,
                isTTS: false,
                cleanMessage: messageText
              };
              this.onMessage(chatMsg);
            } catch (err) {
              console.error('Error parsing IRC line:', err);
            }
          }
        });
      };

      this.ws.onerror = () => {
        this.onLog(`[System Error] WebSocket error. Connection may be unstable.`);
      };

      this.ws.onclose = (event) => {
        this.onLog(`[System] Connection closed. Code: ${event.code}`);
        this.cleanup();
        if (!this.intentionallyDisconnected && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          const baseDelay = Math.min(2000 * Math.pow(1.8, this.reconnectAttempts - 1), 30000);
          const jitter = Math.random() * 1000;
          const delay = baseDelay + jitter;
          this.onLog(`[System] Reconnecting in ${Math.round(delay / 1000)}s... (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
          this.reconnectTimeout = setTimeout(() => this.connect(), delay);
        } else if (!this.intentionallyDisconnected) {
          this.onLog(`[System] Max reconnect attempts reached. Click Connect to try again.`);
          this.onStatusChange('disconnected', this.channelName);
        } else {
          this.onStatusChange('disconnected', this.channelName);
        }
      };

    } catch (err: any) {
      this.onLog(`[System Error] Failed to establish WebSocket: ${err.message}`);
      this.onStatusChange('disconnected', this.channelName);
    }
  }

  private forceReconnect() {
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    this.cleanup();
    this.reconnectAttempts = 0;
    this.onLog('[System] Force-reconnecting...');
    this.connect();
  }

  public disconnect() {
    this.intentionallyDisconnected = true;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      this.onLog('[System] Disconnecting...');
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    this.cleanup();
  }

  private cleanup() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }
}
