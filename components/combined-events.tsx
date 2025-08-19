import React, { useEffect, useState } from 'react';
import { ethers, formatEther } from 'ethers';
import { useAccount } from 'wagmi';

interface GameEvent {
  blockNumber: number;
  transactionHash: string;
  player: string;
  amount: bigint;
  choice: number;
  outcome: number;
  won: boolean;
  gameType: 'dice' | 'coinflip';
  timestamp: number;
}

const ROLL_EVENT_ABI = [
  {
    anonymous: false,
    inputs: [
      { indexed: false, internalType: 'address', name: 'player', type: 'address' },
      { indexed: false, internalType: 'uint256', name: 'amount', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'choice', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'outcome', type: 'uint256' },
      { indexed: false, internalType: 'bool', name: 'won', type: 'bool' }
    ],
    name: 'Roll',
    type: 'event'
  }
];

const ROLL_EVENT_TOPIC0 = ethers.id("Roll(address,uint256,uint256,uint256,bool)");
const DICE_CONTRACT_ADDRESS = "0x095b5DB1A520d96BcAc69E2AeD832273A6f08343";
const COINFLIP_CONTRACT_ADDRESS = "0xb7b23027C7E861d59d2f5b2fE8B3E97ECA534c42";
const BASE_WSS = 'wss://base-mainnet.g.alchemy.com/v2/4GPMAKaRw8IAbyibO-n5K';
const BASE_RPC = 'https://base-mainnet.g.alchemy.com/v2/4GPMAKaRw8IAbyibO-n5K';
const MAX_RESULTS = 12;
const TOTAL_BLOCKS_TO_CHECK = 2000;
const MAX_CHUNK_SIZE = 450;

const CombinedGameEvents: React.FC = () => {
  const { address: currentAccount, isConnected } = useAccount();
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch historical events on mount
  useEffect(() => {
    if (!isConnected || !currentAccount) {
      setEvents([]);
      setLoading(false);
      return;
    }

    let isMounted = true;
    const provider = new ethers.JsonRpcProvider(BASE_RPC);
    const iface = new ethers.Interface(ROLL_EVENT_ABI);

    const fetchEventsForContract = async (contractAddress: string, gameType: 'dice' | 'coinflip') => {
      const latestBlock = await provider.getBlockNumber();
      const startBlock = Math.max(latestBlock - TOTAL_BLOCKS_TO_CHECK, 0);
      const totalBlocksToScan = latestBlock - startBlock;
      const chunksNeeded = Math.ceil(totalBlocksToScan / MAX_CHUNK_SIZE);
      let allLogs: ethers.Log[] = [];

      for (let i = 0; i < chunksNeeded && isMounted; i++) {
        const chunkStart = latestBlock - (i * MAX_CHUNK_SIZE) - MAX_CHUNK_SIZE;
        const chunkEnd = latestBlock - (i * MAX_CHUNK_SIZE);
        const fromBlock = Math.max(chunkStart, startBlock);
        const toBlock = chunkEnd;

        try {
          const logs = await provider.getLogs({
            address: contractAddress,
            fromBlock,
            toBlock,
            topics: [ROLL_EVENT_TOPIC0]
          });
          allLogs.push(...logs);
        } catch (err) {
          // Ignore chunk errors
        }
      }

      const parsedEvents: GameEvent[] = [];
      for (const log of allLogs) {
        try {
          const parsedLog = iface.parseLog({ topics: log.topics, data: log.data });
          const player = parsedLog?.args.player.toLowerCase();
          const block = await provider.getBlock(log.blockNumber);
          if (!block) continue;
          parsedEvents.push({
            blockNumber: log.blockNumber,
            transactionHash: log.transactionHash || "unknown",
            player,
            amount: parsedLog?.args.amount,
            choice: Number(parsedLog?.args.choice),
            outcome: Number(parsedLog?.args.outcome),
            won: parsedLog?.args.won,
            gameType,
            timestamp: Number(block.timestamp)
          });
        } catch (err) {}
      }
      return parsedEvents;
    };

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [diceEvents, coinflipEvents] = await Promise.all([
          fetchEventsForContract(DICE_CONTRACT_ADDRESS, 'dice'),
          fetchEventsForContract(COINFLIP_CONTRACT_ADDRESS, 'coinflip')
        ]);
        if (!isMounted) return;
        const allEvents = [...diceEvents, ...coinflipEvents]
          .sort((a, b) => b.blockNumber - a.blockNumber)
          .slice(0, MAX_RESULTS);
        setEvents(allEvents);
      } catch (err) {
        setError('Failed to fetch events');
      } finally {
        setLoading(false);
      }
    })();

    return () => { isMounted = false; };
  }, [currentAccount, isConnected]);

  // Subscribe to new logs in real time
  useEffect(() => {
    if (!isConnected || !currentAccount) return;
    let isMounted = true;
    const provider = new ethers.WebSocketProvider(BASE_WSS);
    const iface = new ethers.Interface(ROLL_EVENT_ABI);

    const handleLog = async (log: ethers.Log, gameType: 'dice' | 'coinflip') => {
      try {
        const parsedLog = iface.parseLog({ topics: log.topics, data: log.data });
        const player = parsedLog?.args.player.toLowerCase();
        if (player !== currentAccount.toLowerCase()) return;
        const block = await provider.getBlock(log.blockNumber);
        if (!block) return;
        const newEvent: GameEvent = {
          blockNumber: log.blockNumber,
          transactionHash: log.transactionHash || "unknown",
          player,
          amount: parsedLog?.args.amount,
          choice: Number(parsedLog?.args.choice),
          outcome: Number(parsedLog?.args.outcome),
          won: parsedLog?.args.won,
          gameType,
          timestamp: Number(block.timestamp)
        };
        if (isMounted) {
          setEvents(prev => {
            if (prev.some(e => e.transactionHash === newEvent.transactionHash)) return prev;
            return [newEvent, ...prev].sort((a, b) => b.blockNumber - a.blockNumber).slice(0, MAX_RESULTS);
          });
        }
      } catch (err) {}
    };

    provider.on({
      address: DICE_CONTRACT_ADDRESS,
      topics: [ROLL_EVENT_TOPIC0]
    }, (log) => handleLog(log, 'dice'));

    provider.on({
      address: COINFLIP_CONTRACT_ADDRESS,
      topics: [ROLL_EVENT_TOPIC0]
    }, (log) => handleLog(log, 'coinflip'));

    return () => {
      isMounted = false;
      provider.removeAllListeners();
      provider.destroy?.();
    };
  }, [currentAccount, isConnected]);

  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    const diff = Math.floor((Date.now() - date.getTime()) / 60000);
    if (diff < 1) return 'Just now';
    if (diff < 60) return `${diff} min${diff === 1 ? '' : 's'} ago`;
    if (diff < 1440) return `${Math.floor(diff / 60)} hour${Math.floor(diff / 60) === 1 ? '' : 's'} ago`;
    return `${Math.floor(diff / 1440)} day${Math.floor(diff / 1440) === 1 ? '' : 's'} ago`;
  };

  if (loading && events.length === 0) {
    return <div className="p-4 text-center text-blue-600">Loading events...</div>;
  }

  if (error) {
    return <div className="p-4 text-red-600 text-center">Error</div>;
  }

  if (events.length === 0) {
    return;
  }

  return (
    <div className="p-2 rounded-lg shadow-md max-w-4xl mx-auto">
      <h2 className="text-xl font-bold text-white mb-4 text-center">
        PAST BETS
      </h2>
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full border border-black rounded-lg">
          <thead>
            <tr className="border-b border-black">
              <th className="px-4 py-3 text-left text-yellow-300 font-medium">Game</th>
              <th className="px-4 py-3 text-left text-yellow-300 font-medium">Player</th>
              <th className="px-4 py-3 text-left text-yellow-300 font-medium">Amount</th>
              <th className="px-4 py-3 text-left text-yellow-300 font-medium">Choice</th>
              <th className="px-4 py-3 text-left text-yellow-300 font-medium">Outcome</th>
              <th className="px-4 py-3 text-left text-yellow-300 font-medium">Result</th>
              <th className="px-4 py-3 text-left text-yellow-300 font-medium">Time</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event, index) => (
              <tr 
                key={event.transactionHash} 
                className={`border-b border-gray-700/50 hover:bg-gray-700/30 transition-colors ${
                  index % 2 === 0 ? 'bg-gray-800/30' : 'bg-gray-800/50'
                }`}
              >
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    event.gameType === 'dice' 
                      ? 'bg-blue-600/20 text-blue-300 border border-blue-500/30' 
                      : 'bg-purple-600/20 text-purple-300 border border-purple-500/30'
                  }`}>
                    {event.gameType === 'dice' ? '🎲 Dice' : '🪙 Flip'}
                  </span>
                </td>
                <td className="px-4 py-3 text-white font-mono text-sm">
                  {event.player?.slice(0, 6)}...{event.player?.slice(-4)}
                </td>
                <td className="px-4 py-3 text-white">
                  {parseFloat(formatEther(event.amount)).toFixed(4)} ETH
                </td>
                <td className="px-4 py-3 text-white">
                  {event.gameType === 'dice' ? event.choice : (event.choice === 0 ? 'Heads' : 'Tails')}
                </td>
                <td className="px-4 py-3 text-white">
                  {event.gameType === 'dice' ? event.outcome : (event.outcome === 0 ? 'Heads' : 'Tails')}
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    event.won 
                      ? 'bg-green-600/20 text-green-300 border border-green-500/30' 
                      : 'bg-red-600/20 text-red-300 border border-red-500/30'
                  }`}>
                    {event.won ? '✅ Won' : '❌ Lost'}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-400 text-sm">
                  {formatTimestamp(event.timestamp)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* ...mobile view omitted for brevity... */}
    </div>
  );
};

export default CombinedGameEvents;
