import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Plus, Minus, Equal, RotateCcw, User, Coins,
  X as CloseIcon, Wifi, Link as LinkIcon,
  ArrowUpRight, CheckCircle2, AlertCircle, Smartphone, Database, Server
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, onValue, push, onChildAdded, remove, serverTimestamp } from 'firebase/database';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// --- Sound Engine ---
class SoundEngine {
  private ctx: AudioContext | null = null;
  private init() {
    if (!this.ctx) this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  play(type: 'click' | 'confirm' | 'win' | 'reset' | 'error') {
    this.init();
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.connect(gain); gain.connect(this.ctx.destination);
    const now = this.ctx.currentTime;
    switch (type) {
      case 'click':
        osc.frequency.setValueAtTime(440, now); osc.frequency.exponentialRampToValueAtTime(880, now + 0.1);
        gain.gain.setValueAtTime(0.1, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        osc.start(now); osc.stop(now + 0.1); break;
      case 'confirm':
        osc.type = 'triangle';[523.25, 659.25, 783.99].forEach((f, i) => osc.frequency.setValueAtTime(f, now + i * 0.1));
        gain.gain.setValueAtTime(0.2, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
        osc.start(now); osc.stop(now + 0.3); break;
      case 'win':
        osc.type = 'square'; osc.frequency.setValueAtTime(880, now); osc.frequency.exponentialRampToValueAtTime(1760, now + 0.5);
        gain.gain.setValueAtTime(0.1, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
        osc.start(now); osc.stop(now + 0.5); break;
      case 'reset':
        osc.frequency.setValueAtTime(220, now); osc.frequency.linearRampToValueAtTime(110, now + 0.3);
        gain.gain.setValueAtTime(0.1, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
        osc.start(now); osc.stop(now + 0.3); break;
      case 'error':
        osc.type = 'square'; osc.frequency.setValueAtTime(100, now);
        gain.gain.setValueAtTime(0.2, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
        osc.start(now); osc.stop(now + 0.2); break;
    }
  }
}
const sounds = new SoundEngine();

// --- Components ---
const NumberDisplay = ({ value, label, color = "text-white", size = "text-4xl" }: any) => (
  <div className="flex flex-col items-center">
    <span className="text-slate-400 text-[10px] font-semibold mb-1 uppercase tracking-widest">{label}</span>
    <motion.div
      key={value} initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
      className={`mono-font ${size} ${color} font-bold led-glow`}
    >
      {value.toLocaleString()}
    </motion.div>
  </div>
);

const App = () => {
  const INITIAL_BALANCE = 10000;

  // Game State
  const [p1Balance, setP1Balance] = useState(INITIAL_BALANCE);
  const [p2Balance, setP2Balance] = useState(INITIAL_BALANCE);
  const [pool, setPool] = useState(0);
  const [pendingChange, setPendingChange] = useState(0);
  const [winner, setWinner] = useState<number | null>(null);

  // Connection State
  const [roomId, setRoomId] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(true);
  const [inputRoomId, setInputRoomId] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Refs for logic consistency
  const stateRef = useRef({ p1Balance, p2Balance, pool, pendingChange, isHost });
  useEffect(() => {
    stateRef.current = { p1Balance, p2Balance, pool, pendingChange, isHost };
  }, [p1Balance, p2Balance, pool, pendingChange, isHost]);

  // Handle Logic
  const handleAddPending = useCallback(() => {
    if (!stateRef.current.isHost) { sendCommand('ADD'); return; }
    setPendingChange(prev => prev + 1000); sounds.play('click');
  }, []);

  const handleSubPending = useCallback(() => {
    if (!stateRef.current.isHost) { sendCommand('SUB'); return; }
    setPendingChange(prev => {
      if (prev > 0) { sounds.play('click'); return prev - 1000; }
      sounds.play('error'); return prev;
    });
  }, []);

  const handleCommit = useCallback(() => {
    if (!stateRef.current.isHost) { sendCommand('COMMIT'); return; }
    const { p1Balance: p1, p2Balance: p2, pendingChange: pc } = stateRef.current;
    if (pc > 0 && p1 >= pc && p2 >= pc) {
      setP1Balance(p => p - pc); setP2Balance(p => p - pc);
      setPool(p => p + pc * 2); setPendingChange(0);
      sounds.play('confirm');
    } else sounds.play('error');
  }, []);

  const handleWin = useCallback((player: number) => {
    if (!stateRef.current.isHost) { sendCommand(`WIN${player}`); return; }
    setPool(curr => {
      if (curr === 0) { sounds.play('error'); return 0; }
      if (player === 1) setP1Balance(p => p + curr);
      else setP2Balance(p => p + curr);
      setWinner(player); sounds.play('win');
      setTimeout(() => setWinner(null), 3000);
      return 0;
    });
  }, []);

  const handleReset = useCallback(() => {
    if (!stateRef.current.isHost) { sendCommand('RESET'); return; }
    setP1Balance(INITIAL_BALANCE); setP2Balance(INITIAL_BALANCE);
    setPool(0); setPendingChange(0); setWinner(null);
    sounds.play('reset');
  }, []);

  const handleVoid = useCallback(() => {
    if (!stateRef.current.isHost) { sendCommand('VOID'); return; }
    setPool(0); setPendingChange(0); sounds.play('click');
  }, []);

  // --- Firebase Sync Logic ---

  // 1. Host sends commands or states
  const sendCommand = (action: string) => {
    if (!roomId) return;
    push(ref(db, `rooms/${roomId}/commands`), {
      action,
      timestamp: serverTimestamp()
    });
    sounds.play('click');
  };

  // 2. Host Updates Global State
  useEffect(() => {
    if (isHost && isConnected && roomId) {
      set(ref(db, `rooms/${roomId}/state`), {
        p1Balance, p2Balance, pool, pendingChange, winner,
        lastUpdate: serverTimestamp()
      });
    }
  }, [p1Balance, p2Balance, pool, pendingChange, winner, isHost, isConnected, roomId]);

  // 3. Command Listener (Host only)
  useEffect(() => {
    if (!isHost || !isConnected || !roomId) return;
    const commandsRef = ref(db, `rooms/${roomId}/commands`);
    return onChildAdded(commandsRef, (snapshot) => {
      const cmd = snapshot.val();
      if (cmd) {
        switch (cmd.action) {
          case 'ADD': handleAddPending(); break;
          case 'SUB': handleSubPending(); break;
          case 'COMMIT': handleCommit(); break;
          case 'WIN1': handleWin(1); break;
          case 'WIN2': handleWin(2); break;
          case 'RESET': handleReset(); break;
          case 'VOID': handleVoid(); break;
        }
        remove(snapshot.ref); // Clear processed command
      }
    });
  }, [isHost, isConnected, roomId, handleAddPending, handleSubPending, handleCommit, handleWin, handleReset, handleVoid]);

  // 4. State Listener (Client only)
  useEffect(() => {
    if (isHost || !isConnected || !roomId) return;
    const roomStateRef = ref(db, `rooms/${roomId}/state`);
    return onValue(roomStateRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setP1Balance(data.p1Balance);
        setP2Balance(data.p2Balance);
        setPool(data.pool);
        setPendingChange(data.pendingChange);
        setWinner(data.winner);
      }
    });
  }, [isHost, isConnected, roomId]);

  const handleStartSession = (asHost: boolean) => {
    if (!inputRoomId) { setError("โปรดระบุชื่อห้อง"); return; }
    const cleanedId = inputRoomId.trim().toUpperCase();
    setRoomId(cleanedId);
    setIsHost(asHost);
    setIsConnected(true);
    setShowSyncModal(false);
    sounds.play('confirm');

    if (asHost) {
      // Clear old data if hosting new session
      remove(ref(db, `rooms/${cleanedId}`));
    }
  };

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center p-4 bg-[#0f172a] text-slate-100">
      <div className="fixed top-0 left-0 w-full h-full -z-10 opacity-10 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-blue-500 rounded-full blur-[150px]" />
        <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-purple-600 rounded-full blur-[150px]" />
      </div>

      <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="w-full max-w-xl glass-card rounded-[2.5rem] p-6 md:p-10 shadow-2xl relative border-slate-700/50">
        <div className="flex justify-between items-center mb-8 border-b border-slate-700/50 pb-5">
          <div>
            <h1 className="text-2xl font-black text-blue-400 tracking-tighter flex items-center gap-2 italic">
              <Database className="w-6 h-6" /> POT CLOUD
            </h1>
            <div className="flex items-center gap-2 mt-1.5">
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.8)]' : 'bg-slate-600'}`} />
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                {isConnected ? (isHost ? `Master: ${roomId}` : `Remote: ${roomId}`) : 'Cloud Offline'}
              </span>
            </div>
          </div>
          <button onClick={() => setShowSyncModal(true)} className="p-3 rounded-2xl bg-slate-800 text-slate-400 hover:text-white border border-slate-700 transition-all">
            <Wifi className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-8">
          <PlayerCard id={1} balance={p1Balance} isWinner={winner === 1} pending={pendingChange} theme="blue" />
          <PlayerCard id={2} balance={p2Balance} isWinner={winner === 2} pending={pendingChange} theme="pink" />
        </div>

        <div className="relative mb-8 p-8 md:p-12 rounded-[2.5rem] bg-slate-900/80 border border-slate-700/50 flex flex-col items-center justify-center shadow-inner overflow-hidden">
          <AnimatePresence>
            {winner && (
              <motion.div initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 1.5, opacity: 0 }} className="absolute inset-0 flex items-center justify-center z-10 bg-slate-950/60 backdrop-blur-md">
                <div className="rainbow-text text-4xl md:text-6xl text-center leading-tight">PLAYER {winner}<br />WIN!</div>
              </motion.div>
            )}
          </AnimatePresence>
          <Coins className="w-12 h-12 text-yellow-500 mb-3 drop-shadow-[0_0_15px_rgba(234,179,8,0.5)]" />
          <NumberDisplay value={pool} label="Prize Pool" size="text-6xl md:text-8xl" color="text-yellow-400" />
          {pendingChange > 0 && (
            <div className="mt-6 px-5 py-2 bg-green-500/20 text-green-400 rounded-full text-xs font-black border border-green-500/30 flex items-center gap-2">
              <Smartphone className="w-3 h-3" /> STAGING +{(pendingChange * 2).toLocaleString()}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <ControlButton onClick={handleAddPending} icon={<Plus />} label="+1,000" color="bg-blue-600 hover:bg-blue-500" />
            <ControlButton onClick={handleSubPending} icon={<Minus />} label="-1,000" color="bg-slate-700 hover:bg-slate-600" />
            <ControlButton onClick={handleCommit} icon={<Equal className="w-8 h-8" />} label="COMMIT" color="bg-indigo-600 hover:bg-indigo-500 shadow-indigo-500/20 shadow-lg" highlight />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <ControlButton onClick={() => handleWin(1)} icon={<ArrowUpRight />} label="P1 WIN" color="bg-blue-900/30 border-blue-500/30 text-blue-400" />
            <ControlButton onClick={() => handleWin(2)} icon={<ArrowUpRight />} label="P2 WIN" color="bg-pink-900/30 border-pink-500/30 text-pink-400" />
            <div className="grid grid-rows-2 gap-2">
              <button onClick={handleVoid} className="h-full rounded-xl bg-red-900/30 text-red-400 text-[9px] font-bold border border-red-500/20">VOID</button>
              <button onClick={handleReset} className="h-full rounded-xl bg-slate-800 text-slate-500 text-[9px] font-bold border border-slate-700">RESET</button>
            </div>
          </div>
        </div>
      </motion.div>

      <AnimatePresence>
        {showSyncModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-xl">
            <motion.div initial={{ scale: 0.9, y: 30 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 30 }} className="w-full max-w-sm glass-card rounded-[2.5rem] p-8 border-slate-700 shadow-3xl">
              <div className="flex justify-between items-center mb-8">
                <h2 className="text-2xl font-black flex items-center gap-3"><Server className="text-blue-400" /> CLOUD SYNC</h2>
                <button onClick={() => setShowSyncModal(false)} className="p-2 text-slate-500 hover:text-white"><CloseIcon /></button>
              </div>
              <div className="space-y-6">
                <div className="p-5 rounded-3xl bg-slate-900 border border-slate-700/50 focus-within:border-blue-500 transition-all">
                  <p className="text-[10px] text-slate-500 mb-2 uppercase font-black tracking-widest">ชื่อห้อง (Room ID)</p>
                  <input type="text" value={inputRoomId} onChange={(e) => setInputRoomId(e.target.value)} placeholder="เช่น POKER-1" className="w-full bg-transparent text-3xl mono-font font-black text-blue-400 outline-none" maxLength={10} />
                </div>
                {error && <p className="text-red-400 text-xs font-bold">{error}</p>}
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => handleStartSession(true)} className="py-5 rounded-2xl bg-blue-600 font-black hover:bg-blue-500 shadow-lg shadow-blue-500/20">HOST</button>
                  <button onClick={() => handleStartSession(false)} className="py-5 rounded-2xl bg-slate-800 text-slate-300 font-bold border border-slate-700">JOIN</button>
                </div>
                <p className="text-center text-[10px] text-slate-500 leading-relaxed font-medium">
                  * ใช้ Firebase Realtime Database ในการรับส่งข้อมูล<br />
                  * Host คือเครื่องหลักที่ใช้แสดงผล / Join คือเครื่องรีโมท
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const PlayerCard = ({ id, balance, isWinner, pending, theme }: any) => {
  const isBlue = theme === 'blue';
  return (
    <motion.div animate={isWinner ? { scale: [1, 1.05, 1], rotate: [0, -2, 2, 0] } : {}} className={`p-5 rounded-[2rem] flex flex-col items-center justify-center transition-all border-2 relative overflow-hidden ${isWinner ? 'bg-green-500/10 border-green-500/50 shadow-[0_0_30px_rgba(34,197,94,0.3)]' : 'bg-slate-800/40 border-slate-700/50'}`}>
      <div className={`p-2.5 rounded-xl mb-3 ${isBlue ? 'bg-blue-500/10 text-blue-400' : 'bg-pink-500/10 text-pink-400'}`}><User className="w-6 h-6" /></div>
      <NumberDisplay value={balance} label={`PLAYER 0${id}`} size="text-2xl md:text-4xl" color={isWinner ? 'text-green-400' : isBlue ? 'text-blue-300' : 'text-pink-300'} />
      {pending > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-xs text-red-400 mt-2 font-black bg-red-400/10 px-3 py-1 rounded-full border border-red-400/20">- {pending.toLocaleString()}</motion.div>
      )}
    </motion.div>
  );
};

const ControlButton = ({ onClick, icon, label, color, highlight = false }: any) => (
  <button onClick={onClick} className={`flex flex-col items-center justify-center p-4 md:p-6 rounded-[1.5rem] transition-all active:scale-90 group border border-transparent ${color} ${highlight ? 'py-6 shadow-lg' : ''}`}>
    <span className="mb-2 transition-transform group-hover:scale-110">{icon}</span>
    <span className="text-[10px] md:text-xs font-black uppercase tracking-wider opacity-90">{label}</span>
  </button>
);

const root = createRoot(document.getElementById('root')!);
root.render(<App />);