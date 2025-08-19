import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { webSocket } from 'wagmi';
import {
  base
} from 'wagmi/chains';

export const config = getDefaultConfig({
  appName: 'pixelcoinflip',
  projectId: '099e8b5b34a2d1e39fbe28772f347981',
  chains: [
    base
  ],
  ssr: true,
  transports: {
    [base.id]: webSocket('wss://base-mainnet.g.alchemy.com/v2/4GPMAKaRw8IAbyibO-n5K'),
    
  },
});
